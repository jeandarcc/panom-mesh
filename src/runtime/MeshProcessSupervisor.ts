import process from 'node:process'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import type { MeshRunOptions, NormalizedMeshConfig, MeshInstanceRecord } from '../core/types.js'
import { LogStore } from '../logs/LogStore.js'
import { nowIso } from '../utils/time.js'
import { ProcessInstanceSpawner } from '../process/ProcessInstanceSpawner.js'
import { MeshIdFactory } from '../ids/MeshIdFactory.js'
import { RegistryFactory } from '../registry/RegistryFactory.js'
import { HeartbeatLoop } from '../registry/HeartbeatLoop.js'
import type { MeshRegistry } from '../registry/types.js'
import { sleep } from '../utils/time.js'
import { MeshStreamFactory } from '../streaming/MeshStreamFactory.js'
import type { MeshStreamPublisher } from '../streaming/types.js'

interface ManagedChild {
  readonly record: MeshInstanceRecord
  readonly child: ChildProcess
  readonly heartbeat: HeartbeatLoop
}

export class MeshProcessSupervisor {
  private readonly logStore: LogStore
  private readonly spawner: ProcessInstanceSpawner
  private readonly registry: MeshRegistry
  private readonly children = new Map<string, ManagedChild>()
  private readonly ids = new MeshIdFactory()
  private readonly streamPublisher: MeshStreamPublisher | null
  private stopping = false

  public constructor(private readonly config: NormalizedMeshConfig) {
    this.logStore = new LogStore(config.runtime.logsDir)
    this.registry = new RegistryFactory().create(config)
    this.streamPublisher = new MeshStreamFactory().createPublisher(config)
    this.spawner = new ProcessInstanceSpawner(config, this.logStore, this.streamPublisher)
  }

  public async run(options: MeshRunOptions = {}): Promise<void> {
    const services = this.selectServices(options)
    for (const service of services) {
      const count = options.instances ?? service.instances
      for (let index = 0; index < count; index += 1) {
        const managed = await this.registerManaged(await this.spawner.spawn(service, index))
        this.children.set(managed.record.id, managed)
        this.bindExit(managed)
        if (options.watch ?? service.watch) this.pipeToConsole(managed)
      }
    }

    if (this.shouldStartRouter(options, services)) {
      const router = await this.registerManaged(await this.spawnRouter(options.cliPath))
      this.children.set(router.record.id, router)
      this.bindExit(router)
      if (options.watch ?? this.config.runtime.defaultWatch) this.pipeToConsole(router)
    }

    if (options.detach) return
    this.installSignalHandlers()
    await this.waitForever()
  }

  private async registerManaged(spawned: { record: MeshInstanceRecord; child: ChildProcess }): Promise<ManagedChild> {
    const record = await this.registry.register(spawned.record, { ttlMs: this.config.registry.ttlMs })
    await this.streamPublisher?.publish({ kind: 'lifecycle', type: 'mesh.instance.started', instanceId: record.id, service: record.service, payload: { status: 'running', metadata: record.metadata } })
    const heartbeat = new HeartbeatLoop(this.registry, record.id, this.config.registry.heartbeatIntervalMs, this.config.registry.ttlMs)
    heartbeat.start()
    return { record, child: spawned.child, heartbeat }
  }

  private selectServices(options: MeshRunOptions) {
    const all = Array.from(this.config.services.values())
    if (options.all || !options.services || options.services.length === 0) return all.filter(service => service.instances > 0)
    const selected = new Set(options.services)
    const missing = Array.from(selected).filter(name => !this.config.services.has(name))
    if (missing.length > 0) throw new Error(`Unknown mesh service(s): ${missing.join(', ')}`)
    return all.filter(service => selected.has(service.name) && service.instances > 0)
  }

  private shouldStartRouter(options: MeshRunOptions, services: readonly { routes: readonly string[] }[]): boolean {
    if (!this.config.router.enabled) return false
    if (options.router === false) return false
    return services.some(service => service.routes.length > 0)
  }

  private async spawnRouter(cliPath?: string): Promise<{ record: MeshInstanceRecord; child: ChildProcess }> {
    const id = this.ids.createInstanceId('router')
    const resolvedCliPath = cliPath ?? process.argv[1]
    if (!resolvedCliPath) {
      throw new Error('Cannot start mesh router automatically without a CLI path. Use the mesh CLI or run MeshRouterServer directly.')
    }
    const logFile = this.logStore.getLogPath(id)
    const logStream = await this.logStore.createStream(id)
    const command = [process.execPath, resolvedCliPath, 'router', '--config', this.config.configPath]
    const child = spawn(process.execPath, [resolvedCliPath, 'router', '--config', this.config.configPath], {
      cwd: this.config.projectRoot,
      env: {
        ...process.env,
        MESH_APP: this.config.app,
        MESH_SERVICE: 'router',
        MESH_SERVICE_TYPE: 'router',
        MESH_INSTANCE_ID: id,
        MESH_REGISTRY_TYPE: this.config.registry.type,
        MESH_REGISTRY_URL: this.config.registry.url,
        PORT: String(this.config.router.port),
        MESH_PORT: String(this.config.router.port)
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout?.pipe(logStream, { end: false })
    child.stderr?.pipe(logStream, { end: false })
    child.stdout?.on('data', chunk => {
      void this.streamPublisher?.publishLog({ instanceId: id, service: 'router', serviceType: 'router', stream: 'stdout', chunk, source: 'router' })
    })
    child.stderr?.on('data', chunk => {
      void this.streamPublisher?.publishLog({ instanceId: id, service: 'router', serviceType: 'router', stream: 'stderr', chunk, source: 'router' })
    })
    child.once('exit', () => logStream.end())
    const record: MeshInstanceRecord = {
      id,
      service: 'router',
      serviceType: 'router',
      status: 'running',
      pid: child.pid ?? null,
      port: this.config.router.port,
      host: this.config.router.host,
      url: `http://${this.config.router.host}:${this.config.router.port}`,
      command,
      cwd: this.config.projectRoot,
      logFile,
      startedAt: nowIso(),
      metadata: {
        meshApp: this.config.app,
        role: 'mesh-router'
      }
    }
    return { record, child }
  }

  private bindExit(managed: ManagedChild): void {
    managed.child.once('exit', async (code, signal) => {
      managed.heartbeat.stop()
      this.children.delete(managed.record.id)
      if (code === 0 || this.stopping) {
        await this.streamPublisher?.publish({ kind: 'lifecycle', type: 'mesh.instance.stopped', instanceId: managed.record.id, service: managed.record.service, payload: { status: 'stopped', exitCode: code, signal } }).catch(() => undefined)
        await this.registry.unregister(managed.record.id).catch(() => undefined)
        return
      }
      await this.streamPublisher?.publish({ kind: 'lifecycle', type: 'mesh.instance.failed', instanceId: managed.record.id, service: managed.record.service, payload: { status: 'failed', exitCode: code, signal } }).catch(() => undefined)
      await this.registry.heartbeat(managed.record.id, {
        ttlMs: this.config.registry.ttlMs,
        patch: {
          status: 'failed',
          stoppedAt: nowIso(),
          exitCode: code,
          signal
        }
      }).catch(() => undefined)
    })
  }

  private pipeToConsole(managed: ManagedChild): void {
    const prefix = `[${managed.record.id}] `
    managed.child.stdout?.on('data', chunk => process.stdout.write(this.prefixChunk(prefix, chunk)))
    managed.child.stderr?.on('data', chunk => process.stderr.write(this.prefixChunk(prefix, chunk)))
  }

  private prefixChunk(prefix: string, chunk: Buffer): string {
    return chunk.toString('utf8').split(/(?<=\n)/).map(line => line.length ? `${prefix}${line}` : line).join('')
  }

  private installSignalHandlers(): void {
    const stop = (): void => {
      void this.stopAll()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  }

  public async stopAll(): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    const children = Array.from(this.children.values())

    for (const managed of children) {
      managed.heartbeat.stop()
      await this.streamPublisher?.publish({ kind: 'lifecycle', type: 'mesh.instance.draining', instanceId: managed.record.id, service: managed.record.service, payload: { status: 'draining' } }).catch(() => undefined)
      await this.registry.markDraining(managed.record.id).catch(() => undefined)
    }

    await sleep(this.config.runtime.drainTimeoutMs)

    for (const managed of children) {
      if (!this.hasExited(managed.child)) managed.child.kill('SIGTERM')
    }

    const graceful = await this.waitForChildren(children, this.config.runtime.shutdownTimeoutMs)
    if (!graceful) {
      for (const managed of children) {
        if (!this.hasExited(managed.child)) managed.child.kill('SIGKILL')
      }
      await this.waitForChildren(children, this.config.runtime.killTimeoutMs)
    }

    for (const managed of children) {
      await this.registry.unregister(managed.record.id).catch(() => undefined)
    }
    process.exitCode = 0
  }

  private hasExited(child: ChildProcess): boolean {
    return child.exitCode !== null || child.signalCode !== null
  }

  private async waitForChildren(children: readonly ManagedChild[], timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (children.every(managed => this.hasExited(managed.child))) return true
      await sleep(100)
    }
    return children.every(managed => this.hasExited(managed.child))
  }

  private async waitForever(): Promise<void> {
    await new Promise<void>(() => undefined)
  }
}
