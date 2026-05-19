import type { NormalizedMeshConfig } from '../../core/types.js'
import { SimpleRedisClient } from '../../registry/redis/SimpleRedisClient.js'
import { MeshStreamChannels } from '../MeshStreamChannels.js'
import { MeshStreamSerializer } from '../MeshStreamSerializer.js'
import type { MeshLogPublishInput, MeshLogStreamPayload, MeshStreamEnvelope, MeshStreamHandler, MeshStreamPublisher, MeshStreamSubscriber } from '../types.js'
import { RedisPubSubConnection } from './RedisPubSubConnection.js'

export class RedisMeshStream implements MeshStreamPublisher, MeshStreamSubscriber {
  private readonly client: SimpleRedisClient
  private readonly channels: MeshStreamChannels
  private readonly serializer = new MeshStreamSerializer()
  private logSequence = 0

  public constructor(private readonly config: NormalizedMeshConfig) {
    this.client = new SimpleRedisClient({ url: config.streaming.url, connectTimeoutMs: config.streaming.connectTimeoutMs })
    this.channels = new MeshStreamChannels(config.streaming)
  }

  public async publish<TPayload>(input: Omit<MeshStreamEnvelope<TPayload>, 'id' | 'emittedAt' | 'app'> & { readonly app?: string }): Promise<MeshStreamEnvelope<TPayload>> {
    const envelope = this.serializer.create(this.config.app, input)
    const channel = envelope.kind === 'log' ? this.channels.logs() : this.channels.events()
    await this.client.command(['PUBLISH', channel, this.serializer.encode(envelope)])
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

  public async subscribe(types: readonly string[], handler: MeshStreamHandler): Promise<() => Promise<void>> {
    const channels = this.channels.all()
    const wanted = new Set(types)
    const any = wanted.size === 0 || wanted.has('*')
    const connection = new RedisPubSubConnection({ url: this.config.streaming.url, connectTimeoutMs: this.config.streaming.connectTimeoutMs })
    return connection.subscribe(channels, (_channel, message) => {
      const envelope = this.serializer.decode(message)
      if (!envelope) return
      if (!any && !wanted.has(envelope.type) && !wanted.has(envelope.kind)) return
      void handler(envelope)
    })
  }
}
