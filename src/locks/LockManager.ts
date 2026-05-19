import { randomUUID } from 'node:crypto'
import { sleep } from '../utils/time.js'
import { MeshLockTimeoutError } from './LockErrors.js'
import type { MeshLockAcquireOptions, MeshLockBackend, MeshLockLease, MeshLockRecord, MeshLockRunOptions } from './types.js'

export class LockManager {
  private readonly ownerId: string

  public constructor(private readonly backend: MeshLockBackend, ownerId?: string) {
    this.ownerId = ownerId ?? `mesh-${process.pid}-${randomUUID()}`
  }

  public async tryAcquire(key: string, options: MeshLockAcquireOptions = {}): Promise<MeshLockLease | null> {
    return this.backend.acquire(key, this.ownerId, options)
  }

  public async acquire(key: string, options: MeshLockAcquireOptions = {}): Promise<MeshLockLease> {
    const waitMs = options.waitMs ?? 0
    const retryMs = options.retryMs ?? 250
    const deadline = Date.now() + waitMs
    while (true) {
      const lease = await this.tryAcquire(key, options)
      if (lease) return lease
      if (Date.now() >= deadline) throw new MeshLockTimeoutError(key)
      await sleep(Math.min(retryMs, Math.max(1, deadline - Date.now())))
    }
  }

  public async runExclusive<T>(key: string, fn: (lease: MeshLockLease) => Promise<T> | T, options: MeshLockRunOptions = {}): Promise<T> {
    const lease = await this.acquire(key, options)
    const ttlMs = options.ttlMs ?? 30_000
    let stopped = false
    let timer: NodeJS.Timeout | null = null
    if (options.autoRenew ?? true) {
      const every = options.renewEveryMs ?? Math.max(1_000, Math.floor(ttlMs / 2))
      timer = setInterval(() => { if (!stopped) void lease.renew(ttlMs) }, every)
      timer.unref?.()
    }
    try {
      return await fn(lease)
    } finally {
      stopped = true
      if (timer) clearInterval(timer)
      await lease.release()
    }
  }

  public list(): Promise<readonly MeshLockRecord[]> {
    return this.backend.list()
  }
}
