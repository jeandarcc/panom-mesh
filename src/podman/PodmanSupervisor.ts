import process from 'node:process'
import { spawn, type ChildProcess } from 'node:child_process'
import type { MeshRunOptions, MeshInstanceRecord, NormalizedMeshConfig } from '../core/types.js'
import { RegistryFactory } from '../registry/RegistryFactory.js'
import { HeartbeatLoop } from '../registry/HeartbeatLoop.js'
import type { MeshRegistry } from '../registry/types.js'
import { LogStore } from '../logs/LogStore.js'
import { nowIso, sleep } from '../utils/time.js'
import { PodmanCommandBuilder, type PodmanContainerSpec } from './PodmanCommandBuilder.js'
import { PodmanPlan } from './PodmanPlan.js'
import { PodmanRunner } from './PodmanRunner.js'
import { MeshIdFactory } from '../ids/MeshIdFactory.js'
import { ProcessTakeover } from '../process/ProcessTakeover.js'

interface ManagedPodmanContainer {
  readonly spec: PodmanContainerSpec
  readonly record: MeshInstanceRecord
  readonly heartbeat: HeartbeatLoop
}

interface ManagedRouterProcess {
  readonly record: MeshInstanceRecord
  readonly child: ChildProcess
  readonly heartbeat: HeartbeatLoop
}

export class PodmanSupervisor {
  private readonly registry: MeshRegistry
  private readonly logStore: LogStore
  private readonly builder: PodmanCommandBuilder
  private readonly runner: PodmanRunner
  private readonly plan: PodmanPlan
  private readonly ids = new MeshIdFactory()
  private readonly takeover = new ProcessTakeover()
  private readonly containers = new Map<string, ManagedPodmanContainer>()
  private readonly routers = new Map<string, ManagedRouterProcess>()
  private stopping = false

  public constructor(private readonly config: NormalizedMeshConfig) {
    this.registry = new RegistryFactory().create(config)
    this.logStore = new LogStore(config.runtime.logsDir)
    this.builder = new PodmanCommandBuilder(config)
    this.runner = new PodmanRunner(config.runtime.podman.podmanPath)
    this.plan = new PodmanPlan(config)
  }

  public async run(options: MeshRunOptions = {}): Promise<void> {
    const services = this.selectServices(options)
    if (this.config.runtime.podman.createNetwork) await this.ensureNetwork()
    if (this.config.runtime.podman.redis.enabled) await this.ensureRedis()

    const specs = await this.plan.build(services, options.instances)
    for (const spec of specs) {
      const managed = await this.startContainer(spec)
      this.containers.set(managed.record.id, managed)
    }

    if (this.shouldStartRouter(options, services)) {
      const router = await this.startRouterProcess(options.cliPath)
      this.routers.set(router.record.id, router)
      if (options.watch ?? this.config.runtime.defaultWatch) this.pipeToConsole(router)
    }

    if (options.detach) return
    this.installSignalHandlers()
    await this.waitForever()
  }

  public async stop(serviceOrId?: string, options: { readonly force?: boolean; readonly shutdownTimeoutMs?: number } = {}): Promise<string> {
    const instances = await this.registry.list({ includeExpired: true })
    const targets = serviceOrId
      ? instances.filter(instance => instance.service === serviceOrId || instance.id.startsWith(serviceOrId))
      : instances
    let stopped = 0
    for (const target of targets) {
      await this.registry.markDraining(target.id).catch(() => undefined)
      const containerName = this.containerNameFrom(target)
      if (containerName) {
        const timeoutSeconds = Math.ceil((options.shutdownTimeoutMs ?? this.config.runtime.shutdownTimeoutMs) / 1000)
        await this.runner.run(this.builder.stopContainerArgs(containerName, timeoutSeconds), { allowFailure: true })
        if (options.force) await this.runner.run(this.builder.rmContainerArgs(containerName), { allowFailure: true })
        stopped += 1
      } else if (target.pid) {
        try {
          process.kill(target.pid, options.force ? 'SIGKILL' : 'SIGTERM')
          stopped += 1
        } catch {}
      }
      await this.registry.unregister(target.id).catch(() => undefined)
    }
    return `Stopped ${stopped} podman-managed instance(s).\n`
  }

  private async startContainer(spec: PodmanContainerSpec): Promise<ManagedPodmanContainer> {
    const args = this.builder.runServiceArgs(spec)
    await this.runner.run(args)
    const record = await this.registry.register(this.builder.buildRecord(spec), { ttlMs: this.config.registry.ttlMs })
    const heartbeat = new HeartbeatLoop(this.registry, record.id, this.config.registry.heartbeatIntervalMs, this.config.registry.ttlMs)
    heartbeat.start()
    return { spec, record, heartbeat }
  }

  private async ensureNetwork(): Promise<void> {
    const exists = await this.runner.run(this.builder.networkExistsArgs(), { allowFailure: true })
    if (exists.code !== 0) await this.runner.run(this.builder.createNetworkArgs())
  }

  private async ensureRedis(): Promise<void> {
    await this.runner.run(this.builder.runRedisArgs(), { allowFailure: true })
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

  private async startRouterProcess(cliPath?: string): Promise<ManagedRouterProcess> {
    const id = this.ids.createInstanceId('router')
    const resolvedCliPath = cliPath ?? process.argv[1]
    if (!resolvedCliPath) throw new Error('Cannot start mesh router automatically without a CLI path.')
    await this.takeover.forceFreePort(this.config.router.port, { label: `router port ${this.config.router.port}` })
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
      metadata: { runtime: 'process', role: 'mesh-router', meshApp: this.config.app }
    }
    const registered = await this.registry.register(record, { ttlMs: this.config.registry.ttlMs })
    const heartbeat = new HeartbeatLoop(this.registry, registered.id, this.config.registry.heartbeatIntervalMs, this.config.registry.ttlMs)
    heartbeat.start()
    child.once('exit', () => {
      heartbeat.stop()
      void this.registry.unregister(registered.id).catch(() => undefined)
    })
    return { record: registered, child, heartbeat }
  }

  private pipeToConsole(managed: ManagedRouterProcess): void {
    const prefix = `[${managed.record.id}] `
    managed.child.stdout?.on('data', chunk => process.stdout.write(this.prefixChunk(prefix, chunk)))
    managed.child.stderr?.on('data', chunk => process.stderr.write(this.prefixChunk(prefix, chunk)))
  }

  private prefixChunk(prefix: string, chunk: Buffer): string {
    return chunk.toString('utf8').split(/(?<=\n)/).map(line => line.length ? `${prefix}${line}` : line).join('')
  }

  private installSignalHandlers(): void {
    const stop = (): void => { void this.stopAll() }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  }

  private async stopAll(): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    for (const managed of this.containers.values()) managed.heartbeat.stop()
    for (const router of this.routers.values()) router.heartbeat.stop()
    for (const managed of this.containers.values()) {
      await this.registry.markDraining(managed.record.id).catch(() => undefined)
    }
    await sleep(this.config.runtime.drainTimeoutMs)
    for (const managed of this.containers.values()) {
      await this.runner.run(this.builder.stopContainerArgs(managed.spec.name, Math.ceil(this.config.runtime.shutdownTimeoutMs / 1000)), { allowFailure: true })
      await this.registry.unregister(managed.record.id).catch(() => undefined)
    }
    for (const router of this.routers.values()) {
      if (router.child.exitCode === null && router.child.signalCode === null) router.child.kill('SIGTERM')
      await this.registry.unregister(router.record.id).catch(() => undefined)
    }
    process.exitCode = 0
  }

  private containerNameFrom(instance: MeshInstanceRecord): string | null {
    const value = instance.metadata?.containerName
    return typeof value === 'string' ? value : null
  }

  private async waitForever(): Promise<void> {
    await new Promise<void>(() => undefined)
  }
}
