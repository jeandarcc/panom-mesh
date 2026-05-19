import { EventEmitter } from 'node:events'
import type { NormalizedMeshConfig } from '../core/types.js'
import { MeshStreamSerializer } from './MeshStreamSerializer.js'
import type { MeshLogPublishInput, MeshLogStreamPayload, MeshStreamEnvelope, MeshStreamHandler, MeshStreamPublisher, MeshStreamSubscriber } from './types.js'

class MemoryMeshStreamHub {
  public readonly emitter = new EventEmitter()
}

const hubs = new Map<string, MemoryMeshStreamHub>()

function hubFor(app: string): MemoryMeshStreamHub {
  const existing = hubs.get(app)
  if (existing) return existing
  const created = new MemoryMeshStreamHub()
  hubs.set(app, created)
  return created
}

export class MemoryMeshStream implements MeshStreamPublisher, MeshStreamSubscriber {
  private readonly serializer = new MeshStreamSerializer()
  private readonly hub: MemoryMeshStreamHub
  private logSequence = 0

  public constructor(private readonly config: NormalizedMeshConfig) {
    this.hub = hubFor(config.app)
  }

  public async publish<TPayload>(input: Omit<MeshStreamEnvelope<TPayload>, 'id' | 'emittedAt' | 'app'> & { readonly app?: string }): Promise<MeshStreamEnvelope<TPayload>> {
    const envelope = this.serializer.create(this.config.app, input)
    this.hub.emitter.emit(envelope.type, envelope)
    this.hub.emitter.emit('*', envelope)
    return envelope
  }

  public async publishLog(input: MeshLogPublishInput): Promise<MeshStreamEnvelope<MeshLogStreamPayload> | null> {
    if (!this.config.streaming.enabled || !this.config.streaming.logs) return null
    const raw = Buffer.isBuffer(input.chunk) ? input.chunk.toString('utf8') : input.chunk
    const max = this.config.streaming.maxLogChunkBytes
    const chunk = raw.length > max ? raw.slice(0, max) : raw
    return this.publish<MeshLogStreamPayload>({
      kind: 'log',
      type: 'mesh.log',
      ...(input.source !== undefined ? { source: input.source } : {}),
      instanceId: input.instanceId,
      service: input.service,
      payload: {
        stream: input.stream,
        chunk,
        sequence: this.logSequence += 1,
        truncated: raw.length > max,
        ...(input.serviceType !== undefined ? { serviceType: input.serviceType } : {})
      }
    })
  }

  public async subscribe(types: readonly string[], handler: MeshStreamHandler): Promise<() => void> {
    const eventNames = types.length > 0 ? types : ['*']
    const wrapped = (event: MeshStreamEnvelope): void => { void handler(event) }
    for (const type of eventNames) this.hub.emitter.on(type, wrapped)
    return () => {
      for (const type of eventNames) this.hub.emitter.off(type, wrapped)
    }
  }
}
