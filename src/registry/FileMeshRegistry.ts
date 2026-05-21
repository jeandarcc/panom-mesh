import type { MeshInstanceRecord } from '../core/types.js'
import { MeshStateStore } from '../state/MeshStateStore.js'
import type { MeshRegistry, MeshRegistryHeartbeatOptions, MeshRegistryListOptions, MeshRegistryRegisterOptions } from './types.js'
import { RegistryRecordTools } from './RegistryRecordTools.js'

export class FileMeshRegistry implements MeshRegistry {
  public readonly kind = 'file'
  private readonly store: MeshStateStore

  public constructor(app: string, stateDir: string) {
    this.store = new MeshStateStore(app, stateDir)
  }

  public async register(instance: MeshInstanceRecord, options: MeshRegistryRegisterOptions = {}): Promise<MeshInstanceRecord> {
    const record = options.ttlMs ? RegistryRecordTools.touch(instance, options.ttlMs) : instance
    await this.store.upsert(record)
    return record
  }

  public async heartbeat(instanceId: string, options: MeshRegistryHeartbeatOptions = {}): Promise<MeshInstanceRecord | null> {
    const current = await this.get(instanceId)
    if (!current) return null
    const patched = { ...current, ...(options.patch ?? {}) } as MeshInstanceRecord
    const next = options.ttlMs ? RegistryRecordTools.touch(patched, options.ttlMs) : patched
    await this.store.upsert(next)
    return next
  }

  public async list(options: MeshRegistryListOptions = {}): Promise<readonly MeshInstanceRecord[]> {
    const state = await this.store.read()
    const refreshed = state.instances.map(instance => RegistryRecordTools.markExpired(instance))
    return refreshed.filter(instance => {
      if (options.service && instance.service !== options.service) return false
      if (!options.includeExpired && instance.status === 'expired') return false
      return true
    })
  }

  public async get(instanceId: string): Promise<MeshInstanceRecord | null> {
    const state = await this.store.read()
    return state.instances.find(instance => instance.id === instanceId) ?? null
  }

  public async markDraining(instanceId: string): Promise<MeshInstanceRecord | null> {
    const current = await this.get(instanceId)
    if (!current) return null
    const next = { ...current, status: 'draining' as const }
    await this.store.upsert(next)
    return next
  }

  public async unregister(instanceId: string): Promise<void> {
    await this.store.remove([instanceId])
  }
}
