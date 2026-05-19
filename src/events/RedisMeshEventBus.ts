import { randomUUID } from 'node:crypto'
import type { NormalizedMeshConfig } from '../core/types.js'
import { MeshStreamFactory } from '../streaming/MeshStreamFactory.js'
import type { MeshStreamEnvelope } from '../streaming/types.js'
import type { MeshEventBus, MeshEventEnvelope, MeshEventHandler } from './MeshEventBus.js'

export class RedisMeshEventBus implements MeshEventBus {
  public constructor(private readonly config: NormalizedMeshConfig) {}

  public async emit<TPayload>(type: string, payload: TPayload, source?: string): Promise<MeshEventEnvelope<TPayload>> {
    const envelope: MeshEventEnvelope<TPayload> = {
      id: randomUUID(),
      app: this.config.app,
      type,
      payload,
      emittedAt: new Date().toISOString(),
      ...(source !== undefined ? { source } : {})
    }
    const publisher = new MeshStreamFactory().createPublisher(this.config)
    await publisher?.publish({ kind: 'event', type, ...(source !== undefined ? { source } : {}), payload })
    return envelope
  }

  public on<TPayload>(type: string, handler: MeshEventHandler<TPayload>): () => void {
    const subscriber = new MeshStreamFactory().createSubscriber(this.config)
    if (!subscriber) return () => undefined
    let stop: (() => void | Promise<void>) | null = null
    void subscriber.subscribe([type === '*' ? '*' : type], event => {
      if (event.kind !== 'event') return
      const converted = this.toEventEnvelope<TPayload>(event)
      if (!converted) return
      void handler(converted)
    }).then(unsubscribe => { stop = unsubscribe })
    return () => { if (stop) void stop() }
  }

  private toEventEnvelope<TPayload>(event: MeshStreamEnvelope): MeshEventEnvelope<TPayload> | null {
    return {
      id: event.id,
      app: event.app,
      type: event.type,
      payload: event.payload as TPayload,
      emittedAt: event.emittedAt,
      ...(event.source !== undefined ? { source: event.source } : {})
    }
  }
}
