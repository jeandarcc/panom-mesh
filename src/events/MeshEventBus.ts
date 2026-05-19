import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'

export interface MeshEventEnvelope<TPayload = unknown> {
  readonly id: string
  readonly app: string
  readonly type: string
  readonly payload: TPayload
  readonly emittedAt: string
  readonly source?: string
}

export type MeshEventHandler<TPayload = unknown> = (event: MeshEventEnvelope<TPayload>) => void | Promise<void>

export interface MeshEventBus {
  emit<TPayload>(type: string, payload: TPayload, source?: string): Promise<MeshEventEnvelope<TPayload>>
  on<TPayload>(type: string, handler: MeshEventHandler<TPayload>): () => void
}

export class MemoryMeshEventBus implements MeshEventBus {
  private readonly emitter = new EventEmitter()

  public constructor(private readonly app: string) {}

  public async emit<TPayload>(type: string, payload: TPayload, source?: string): Promise<MeshEventEnvelope<TPayload>> {
    const envelope: MeshEventEnvelope<TPayload> = {
      id: randomUUID(),
      app: this.app,
      type,
      payload,
      emittedAt: new Date().toISOString(),
      ...(source !== undefined ? { source } : {})
    }
    this.emitter.emit(type, envelope)
    this.emitter.emit('*', envelope)
    return envelope
  }

  public on<TPayload>(type: string, handler: MeshEventHandler<TPayload>): () => void {
    const wrapped = (event: MeshEventEnvelope<TPayload>): void => {
      void handler(event)
    }
    this.emitter.on(type, wrapped)
    return () => this.emitter.off(type, wrapped)
  }
}
