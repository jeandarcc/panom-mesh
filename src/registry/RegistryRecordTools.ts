import type { MeshInstanceRecord, MeshInstanceStatus } from '../core/types.js'

export class RegistryRecordTools {
  public static touch(instance: MeshInstanceRecord, ttlMs: number, now = Date.now()): MeshInstanceRecord {
    return {
      ...instance,
      status: instance.status === 'expired' ? 'running' : instance.status,
      lastSeenAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString()
    }
  }

  public static markExpired(instance: MeshInstanceRecord, now = Date.now()): MeshInstanceRecord {
    if (!this.isExpired(instance, now)) return instance
    return { ...instance, status: 'expired' as MeshInstanceStatus }
  }

  public static isExpired(instance: MeshInstanceRecord, now = Date.now()): boolean {
    if (!instance.expiresAt) return false
    return new Date(instance.expiresAt).getTime() <= now
  }

  public static isRoutable(instance: MeshInstanceRecord, now = Date.now()): boolean {
    return instance.status === 'running'
      && instance.url !== null
      && instance.serviceType !== 'worker'
      && instance.serviceType !== 'router'
      && !this.isExpired(instance, now)
  }
}
