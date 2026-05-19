import type { MeshLockBackend, MeshLockLease as MeshLockLeaseContract } from './types.js'

export class LockLease implements MeshLockLeaseContract {
  public constructor(
    private readonly backend: MeshLockBackend,
    public readonly key: string,
    public readonly ownerId: string,
    public readonly acquiredAt: string,
    public readonly expiresAt: string
  ) {}

  public async renew(ttlMs = 30_000): Promise<boolean> {
    return this.backend.renew(this.key, this.ownerId, ttlMs)
  }

  public async release(): Promise<boolean> {
    return this.backend.release(this.key, this.ownerId)
  }
}
