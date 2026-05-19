import type { MeshInstanceRecord, NormalizedMeshConfig } from '../core/types.js'

export interface MeshRegistryListOptions {
  readonly service?: string
  readonly includeExpired?: boolean
}

export interface MeshRegistryRegisterOptions {
  readonly ttlMs?: number
}

export interface MeshRegistryHeartbeatOptions {
  readonly ttlMs?: number
  readonly patch?: Partial<MeshInstanceRecord>
}

export interface MeshRegistry {
  readonly kind: string
  register(instance: MeshInstanceRecord, options?: MeshRegistryRegisterOptions): Promise<MeshInstanceRecord>
  heartbeat(instanceId: string, options?: MeshRegistryHeartbeatOptions): Promise<MeshInstanceRecord | null>
  list(options?: MeshRegistryListOptions): Promise<readonly MeshInstanceRecord[]>
  get(instanceId: string): Promise<MeshInstanceRecord | null>
  markDraining(instanceId: string): Promise<MeshInstanceRecord | null>
  unregister(instanceId: string): Promise<void>
}

export interface MeshRegistryFactoryContext {
  readonly config: NormalizedMeshConfig
}

export type MeshRegistryFactory = (context: MeshRegistryFactoryContext) => MeshRegistry

export interface MeshRegistryRuntimeOptions {
  readonly heartbeatIntervalMs: number
  readonly ttlMs: number
}
