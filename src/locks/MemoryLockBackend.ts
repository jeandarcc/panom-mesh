import { LockLease } from './LockLease.js'
import type { MeshLockAcquireOptions, MeshLockBackend, MeshLockLease, MeshLockRecord } from './types.js'

export class MemoryLockBackend implements MeshLockBackend {
  public readonly kind = 'memory'
  private readonly locks = new Map<string, MeshLockRecord>()

  public async acquire(key: string, ownerId: string, options: MeshLockAcquireOptions = {}): Promise<MeshLockLease | null> {
    this.pruneExpired()
    if (this.locks.has(key)) return null
    const ttlMs = options.ttlMs ?? 30_000
    const acquiredAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + ttlMs).toISOString()
    const record: MeshLockRecord = { key, ownerId, acquiredAt, expiresAt, ...(options.metadata ? { metadata: options.metadata } : {}) }
    this.locks.set(key, record)
    return new LockLease(this, key, ownerId, acquiredAt, expiresAt)
  }

  public async renew(key: string, ownerId: string, ttlMs: number): Promise<boolean> {
    this.pruneExpired()
    const current = this.locks.get(key)
    if (!current || current.ownerId !== ownerId) return false
    this.locks.set(key, { ...current, expiresAt: new Date(Date.now() + ttlMs).toISOString() })
    return true
  }

  public async release(key: string, ownerId: string): Promise<boolean> {
    this.pruneExpired()
    const current = this.locks.get(key)
    if (!current || current.ownerId !== ownerId) return false
    this.locks.delete(key)
    return true
  }

  public async list(): Promise<readonly MeshLockRecord[]> {
    this.pruneExpired()
    return Array.from(this.locks.values()).sort((a, b) => a.key.localeCompare(b.key))
  }

  private pruneExpired(): void {
    const now = Date.now()
    for (const [key, record] of this.locks) {
      if (new Date(record.expiresAt).getTime() <= now) this.locks.delete(key)
    }
  }
}
