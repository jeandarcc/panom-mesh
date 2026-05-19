import os from 'node:os'
import { MeshIdFactory } from '../ids/MeshIdFactory.js'
import { FileMeshRegistry } from '../registry/FileMeshRegistry.js'
import { RedisMeshRegistry } from '../registry/redis/RedisMeshRegistry.js'
import { HeartbeatLoop } from '../registry/HeartbeatLoop.js'
import type { MeshRegistry } from '../registry/types.js'
import type { MeshInstanceRecord, MeshServiceType, NormalizedMeshConfig } from '../core/types.js'
import { nowIso } from '../utils/time.js'
import type { MeshStreamPublisher } from '../streaming/types.js'
import { MeshStreamFactory } from '../streaming/MeshStreamFactory.js'

export interface MeshNodeOptions {
  readonly app: string
  readonly service: string
  readonly serviceType?: MeshServiceType
  readonly nodeId?: string
  readonly internalUrl?: string
  readonly port?: number
  readonly host?: string
  readonly registry?: MeshRegistry | { type: 'file'; stateDir: string } | { type: 'redis'; url: string; secret?: string; keyPrefix?: string }
  readonly secret?: string
  readonly heartbeatIntervalMs?: number
  readonly ttlMs?: number
  readonly metadata?: Record<string, unknown>
  readonly stream?: MeshStreamPublisher | NormalizedMeshConfig
}

export interface MeshNodeSignalHandlerOptions {
  readonly onDrain?: () => Promise<void> | void
  readonly onStop?: () => Promise<void> | void
  readonly exit?: boolean
}

export class MeshNode {
  private readonly registry: MeshRegistry
  private readonly id: string
  private heartbeat: HeartbeatLoop | null = null
  private readonly streamPublisher: MeshStreamPublisher | null
  private record: MeshInstanceRecord | null = null
  private stopping = false

  public constructor(private readonly options: MeshNodeOptions) {
    this.id = options.nodeId ?? new MeshIdFactory().createInstanceId(options.service)
    this.registry = this.resolveRegistry(options)
    this.streamPublisher = this.resolveStream(options)
  }

  public async start(): Promise<MeshInstanceRecord> {
    const ttlMs = this.options.ttlMs ?? 15_000
    const record = this.buildRecord()
    this.record = await this.registry.register(record, { ttlMs })
    this.heartbeat = new HeartbeatLoop(this.registry, this.record.id, this.options.heartbeatIntervalMs ?? 5_000, ttlMs)
    this.heartbeat.start()
    await this.streamPublisher?.publish({ kind: 'lifecycle', type: 'mesh.instance.started', instanceId: this.record.id, service: this.record.service, payload: { status: 'running', metadata: this.record.metadata } }).catch(() => undefined)
    return this.record
  }

  public async drain(): Promise<void> {
    if (!this.record) return
    await this.streamPublisher?.publish({ kind: 'lifecycle', type: 'mesh.instance.draining', instanceId: this.record.id, service: this.record.service, payload: { status: 'draining' } }).catch(() => undefined)
    await this.registry.markDraining(this.record.id)
  }

  public async stop(): Promise<void> {
    if (!this.record) return
    this.heartbeat?.stop()
    await this.streamPublisher?.publish({ kind: 'lifecycle', type: 'mesh.instance.stopped', instanceId: this.record.id, service: this.record.service, payload: { status: 'stopped' } }).catch(() => undefined)
    await this.registry.unregister(this.record.id)
  }


  public async emit<TPayload>(type: string, payload: TPayload): Promise<void> {
    await this.streamPublisher?.publish({
      kind: 'event',
      type,
      instanceId: this.record?.id ?? this.id,
      service: this.options.service,
      payload,
      source: 'node'
    })
  }

  public async log(stream: 'stdout' | 'stderr' | 'system', chunk: string | Buffer): Promise<void> {
    await this.streamPublisher?.publishLog({
      instanceId: this.record?.id ?? this.id,
      service: this.options.service,
      serviceType: this.options.serviceType ?? 'backend',
      stream,
      chunk,
      source: 'node'
    })
  }

  public installSignalHandlers(options: MeshNodeSignalHandlerOptions = {}): void {
    const handler = (signal: NodeJS.Signals): void => {
      void this.gracefulSignalStop(signal, options)
    }
    process.once('SIGTERM', handler)
    process.once('SIGINT', handler)
  }

  private async gracefulSignalStop(signal: NodeJS.Signals, options: MeshNodeSignalHandlerOptions): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    await this.drain().catch(() => undefined)
    await options.onDrain?.()
    await options.onStop?.()
    await this.stop().catch(() => undefined)
    if (options.exit ?? true) {
      process.exitCode = signal === 'SIGINT' ? 130 : 0
      process.exit()
    }
  }

  private buildRecord(): MeshInstanceRecord {
    const port = this.options.port ?? numberFromEnv('MESH_PORT') ?? numberFromEnv('PORT')
    const internalUrl = this.options.internalUrl ?? process.env.MESH_INTERNAL_URL ?? (port ? `http://${this.options.host ?? '127.0.0.1'}:${port}` : null)
    return {
      id: this.id,
      service: this.options.service,
      serviceType: this.options.serviceType ?? 'backend',
      status: 'running',
      pid: process.pid,
      port: port ?? null,
      host: this.options.host ?? os.hostname(),
      url: internalUrl,
      command: process.argv,
      cwd: process.cwd(),
      logFile: '',
      startedAt: nowIso(),
      metadata: {
        ...(this.options.metadata ?? {}),
        meshApp: this.options.app,
        externalNode: true,
        gracefulDrain: true
      }
    }
  }


  private resolveStream(options: MeshNodeOptions): MeshStreamPublisher | null {
    if (!options.stream) return null
    if ('publish' in options.stream) return options.stream
    return new MeshStreamFactory().createPublisher(options.stream)
  }

  private resolveRegistry(options: MeshNodeOptions): MeshRegistry {
    if (options.registry && 'register' in options.registry) return options.registry
    const declared = options.registry
    if (declared?.type === 'file') return new FileMeshRegistry(options.app, declared.stateDir)
    if (declared?.type === 'redis') return new RedisMeshRegistry({ app: options.app, url: declared.url, ...((declared.secret ?? options.secret) !== undefined ? { secret: (declared.secret ?? options.secret)! } : {}), ...(declared.keyPrefix !== undefined ? { keyPrefix: declared.keyPrefix } : {}) })
    if (process.env.MESH_REGISTRY_TYPE === 'redis' && process.env.MESH_REGISTRY_URL) {
      return new RedisMeshRegistry({ app: options.app, url: process.env.MESH_REGISTRY_URL, ...(options.secret !== undefined ? { secret: options.secret } : {}) })
    }
    return new FileMeshRegistry(options.app, '.mesh')
  }
}

export function createMeshNode(options: MeshNodeOptions): MeshNode {
  return new MeshNode(options)
}

function numberFromEnv(key: string): number | undefined {
  const value = process.env[key]
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : undefined
}
