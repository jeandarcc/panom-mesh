import type { LockManager } from '../locks/LockManager.js'
import type { MeshLockLease } from '../locks/types.js'
import type { MeshLeaderHandle, MeshLeaderRecord, MeshLeaderRunOptions } from './types.js'

export class LeaderElection {
  public constructor(private readonly locks: LockManager, private readonly leaderId: string) {}

  public async tryElect(group: string, options: MeshLeaderRunOptions = {}): Promise<MeshLeaderHandle | null> {
    const lease = await this.locks.tryAcquire(this.key(group), {
      ttlMs: options.ttlMs ?? 30_000,
      waitMs: 0,
      metadata: { ...(options.metadata ?? {}), group, leaderId: this.leaderId, kind: 'leader' }
    })
    return lease ? this.toHandle(group, lease) : null
  }

  public async elect(group: string, options: MeshLeaderRunOptions = {}): Promise<MeshLeaderHandle> {
    const lease = await this.locks.acquire(this.key(group), {
      ttlMs: options.ttlMs ?? 30_000,
      waitMs: options.waitMs ?? 0,
      metadata: { ...(options.metadata ?? {}), group, leaderId: this.leaderId, kind: 'leader' }
    })
    return this.toHandle(group, lease)
  }

  public async runWhenLeader<T>(group: string, fn: (signal: AbortSignal, leader: MeshLeaderHandle) => Promise<T> | T, options: MeshLeaderRunOptions = {}): Promise<T | null> {
    const handle = await this.tryElect(group, options)
    if (!handle) return null
    const controller = new AbortController()
    const ttlMs = options.ttlMs ?? 30_000
    const every = options.renewEveryMs ?? Math.max(1_000, Math.floor(ttlMs / 2))
    const timer = setInterval(() => { void handleRenew(handle, ttlMs, controller) }, every)
    timer.unref?.()
    try {
      return await fn(controller.signal, handle)
    } finally {
      controller.abort()
      clearInterval(timer)
      await handle.release()
    }
  }

  public async list(): Promise<readonly MeshLeaderRecord[]> {
    const locks = await this.locks.list()
    return locks
      .filter(lock => lock.metadata?.kind === 'leader' && typeof lock.metadata.group === 'string')
      .map(lock => ({
        group: String(lock.metadata!.group),
        leaderId: String(lock.metadata!.leaderId ?? lock.ownerId),
        acquiredAt: lock.acquiredAt,
        expiresAt: lock.expiresAt,
        ...(lock.metadata ? { metadata: lock.metadata } : {})
      }))
      .sort((a, b) => a.group.localeCompare(b.group))
  }

  private toHandle(group: string, lease: MeshLockLease): MeshLeaderHandle & { renew(ttlMs?: number): Promise<boolean> } {
    return {
      group,
      leaderId: this.leaderId,
      acquiredAt: lease.acquiredAt,
      expiresAt: lease.expiresAt,
      release: () => lease.release(),
      renew: (ttlMs?: number) => lease.renew(ttlMs)
    }
  }

  private key(group: string): string {
    return `leader:${group}`
  }
}

async function handleRenew(handle: MeshLeaderHandle & { renew?: (ttlMs?: number) => Promise<boolean> }, ttlMs: number, controller: AbortController): Promise<void> {
  const renew = handle.renew
  if (!renew) return
  const ok = await renew(ttlMs)
  if (!ok) controller.abort()
}
