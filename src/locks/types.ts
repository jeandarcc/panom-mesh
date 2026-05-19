export interface MeshLockAcquireOptions {
  readonly ttlMs?: number
  readonly waitMs?: number
  readonly retryMs?: number
  readonly metadata?: Record<string, unknown>
}

export interface MeshLockRunOptions extends MeshLockAcquireOptions {
  readonly autoRenew?: boolean
  readonly renewEveryMs?: number
}

export interface MeshLockRecord {
  readonly key: string
  readonly ownerId: string
  readonly acquiredAt: string
  readonly expiresAt: string
  readonly metadata?: Record<string, unknown>
}

export interface MeshLockLease {
  readonly key: string
  readonly ownerId: string
  readonly acquiredAt: string
  readonly expiresAt: string
  renew(ttlMs?: number): Promise<boolean>
  release(): Promise<boolean>
}

export interface MeshLockBackend {
  readonly kind: string
  acquire(key: string, ownerId: string, options?: MeshLockAcquireOptions): Promise<MeshLockLease | null>
  renew(key: string, ownerId: string, ttlMs: number): Promise<boolean>
  release(key: string, ownerId: string): Promise<boolean>
  list(): Promise<readonly MeshLockRecord[]>
}
