import type { MeshServiceType } from '../core/types.js'

export type MeshStreamKind = 'log' | 'event' | 'lifecycle' | 'metric'
export type MeshLogStreamName = 'stdout' | 'stderr' | 'system'

export interface MeshStreamEnvelope<TPayload = unknown> {
  readonly id: string
  readonly app: string
  readonly kind: MeshStreamKind
  readonly type: string
  readonly payload: TPayload
  readonly emittedAt: string
  readonly source?: string
  readonly instanceId?: string
  readonly service?: string
}

export interface MeshLogStreamPayload {
  readonly stream: MeshLogStreamName
  readonly chunk: string
  readonly sequence: number
  readonly truncated: boolean
  readonly serviceType?: MeshServiceType
}

export interface MeshLifecycleStreamPayload {
  readonly status: string
  readonly message?: string
  readonly metadata?: Record<string, unknown>
}

export type MeshStreamHandler<TPayload = unknown> = (event: MeshStreamEnvelope<TPayload>) => void | Promise<void>

export interface MeshStreamPublisher {
  publish<TPayload>(event: Omit<MeshStreamEnvelope<TPayload>, 'id' | 'emittedAt' | 'app'> & { readonly app?: string }): Promise<MeshStreamEnvelope<TPayload>>
  publishLog(input: MeshLogPublishInput): Promise<MeshStreamEnvelope<MeshLogStreamPayload> | null>
}

export interface MeshStreamSubscriber {
  subscribe(types: readonly string[], handler: MeshStreamHandler): Promise<() => Promise<void> | void>
}

export interface MeshLogPublishInput {
  readonly instanceId: string
  readonly service: string
  readonly serviceType?: MeshServiceType
  readonly stream: MeshLogStreamName
  readonly chunk: Buffer | string
  readonly source?: string
}

export interface MeshStreamSubscribeOptions {
  readonly kinds?: readonly MeshStreamKind[]
  readonly types?: readonly string[]
  readonly services?: readonly string[]
  readonly instances?: readonly string[]
}
