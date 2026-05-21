import { spawn, type ChildProcess } from 'node:child_process'
import type { NormalizedMeshConfig, NormalizedMeshServiceConfig, MeshInstanceRecord } from '../core/types.js'
import { MeshIdFactory } from '../ids/MeshIdFactory.js'
import { LogStore } from '../logs/LogStore.js'
import { nowIso } from '../utils/time.js'
import { PortAllocator } from './PortAllocator.js'
import { ProcessTakeover } from './ProcessTakeover.js'
import type { MeshStreamPublisher } from '../streaming/types.js'

export interface SpawnedMeshInstance {
  readonly record: MeshInstanceRecord
  readonly child: ChildProcess
}

export class ProcessInstanceSpawner {
  private readonly ids = new MeshIdFactory()
  private readonly ports = new PortAllocator()
  private readonly takeover = new ProcessTakeover()

  public constructor(
    private readonly config: NormalizedMeshConfig,
    private readonly logStore: LogStore,
    private readonly streamPublisher: MeshStreamPublisher | null = null
  ) {}

  public async spawn(service: NormalizedMeshServiceConfig, index: number, totalInstances = service.instances): Promise<SpawnedMeshInstance> {
    const id = this.ids.createInstanceId(service.name)
    if (service.type !== 'worker' && service.port !== undefined && index === 0) {
      await this.takeover.forceFreePort(service.port, { label: `${service.name} preferred port ${service.port}` })
    }
    const port = service.type === 'worker'
      ? null
      : await this.ports.reservePreferred(index === 0 ? service.port : undefined, service.portRange)
    const logFile = this.logStore.getLogPath(id)
    const logStream = await this.logStore.createStream(id)
    const env = this.buildEnv(service, id, port, index, totalInstances)
    const [command, ...args] = service.command

    const child = spawn(command!, args, {
      cwd: service.cwd,
      env,
      shell: service.shell,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    child.stdout?.pipe(logStream, { end: false })
    child.stderr?.pipe(logStream, { end: false })
    child.stdout?.on('data', chunk => {
      void this.streamPublisher?.publishLog({ instanceId: id, service: service.name, serviceType: service.type, stream: 'stdout', chunk, source: 'process' })
    })
    child.stderr?.on('data', chunk => {
      void this.streamPublisher?.publishLog({ instanceId: id, service: service.name, serviceType: service.type, stream: 'stderr', chunk, source: 'process' })
    })

    const record: MeshInstanceRecord = {
      id,
      service: service.name,
      serviceType: service.type,
      status: 'running',
      pid: child.pid ?? null,
      port,
      host: this.config.router.host,
      url: port === null ? null : `http://${this.config.router.host}:${port}`,
      command: service.command,
      cwd: service.cwd,
      logFile,
      startedAt: nowIso(),
      metadata: {
        index,
        routes: service.routes,
        hsmRoutes: service.hsmRoutes,
        strategy: service.strategy,
        healthPath: service.healthPath,
        meshApp: this.config.app
      }
    }

    child.once('exit', () => {
      logStream.end()
    })

    return { record, child }
  }

  private buildEnv(
    service: NormalizedMeshServiceConfig,
    instanceId: string,
    port: number | null,
    index: number,
    totalInstances: number,
  ): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...service.env,
      MESH_APP: this.config.app,
      MESH_SERVICE: service.name,
      MESH_SERVICE_TYPE: service.type,
      MESH_INSTANCE_ID: instanceId,
      MESH_INSTANCE_INDEX: String(index),
      MESH_SERVICE_INSTANCES: String(totalInstances),
      PANOM_API_INSTANCES: String(totalInstances),
      MESH_REGISTRY_TYPE: this.config.registry.type,
      MESH_REGISTRY_URL: this.config.registry.url,
      MESH_REGISTRY_TTL_MS: String(this.config.registry.ttlMs),
      MESH_HEARTBEAT_INTERVAL_MS: String(this.config.registry.heartbeatIntervalMs),
      MESH_ROUTER_HOST: this.config.router.host,
      MESH_ROUTER_PORT: String(this.config.router.port),
      ...(port === null ? {} : { PORT: String(port), MESH_PORT: String(port) })
    }
  }
}
