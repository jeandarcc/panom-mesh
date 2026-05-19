import { describe, expect, it } from 'vitest'
import { MeshConfigNormalizer } from '../src/config/MeshConfigNormalizer.js'
import { CleanupScheduler } from '../src/cleanup/CleanupScheduler.js'
import { LeaderElection } from '../src/leader/LeaderElection.js'
import { LockManager } from '../src/locks/LockManager.js'
import { MemoryLockBackend } from '../src/locks/MemoryLockBackend.js'

const normalizer = new MeshConfigNormalizer()

describe('distributed coordination', () => {
  it('normalizes coordination defaults from registry settings', () => {
    const config = normalizer.normalize({
      app: 'panom',
      registry: { type: 'redis', url: 'redis://localhost:6379', keyPrefix: 'mesh:test' },
      services: { api: { command: 'node api.js' } }
    })
    expect(config.coordination.enabled).toBe(true)
    expect(config.coordination.backend).toBe('redis')
    expect(config.coordination.keyPrefix).toBe('mesh:test')
  })

  it('acquires, renews and releases owner-scoped locks', async () => {
    const backend = new MemoryLockBackend()
    const ownerA = new LockManager(backend, 'owner-a')
    const ownerB = new LockManager(backend, 'owner-b')
    const lease = await ownerA.acquire('media:1', { ttlMs: 1000 })
    expect(await ownerB.tryAcquire('media:1')).toBeNull()
    expect(await lease.renew(1000)).toBe(true)
    expect(await lease.release()).toBe(true)
    expect(await ownerB.tryAcquire('media:1')).toBeTruthy()
  })

  it('elects a single leader per group', async () => {
    const backend = new MemoryLockBackend()
    const a = new LeaderElection(new LockManager(backend, 'node-a'), 'node-a')
    const b = new LeaderElection(new LockManager(backend, 'node-b'), 'node-b')
    const leader = await a.tryElect('cleanup')
    expect(leader?.leaderId).toBe('node-a')
    expect(await b.tryElect('cleanup')).toBeNull()
    expect((await a.list()).map(item => item.group)).toEqual(['cleanup'])
    await leader?.release()
    expect((await b.tryElect('cleanup'))?.leaderId).toBe('node-b')
  })

  it('runs cleanup tasks under lock protection', async () => {
    const locks = new LockManager(new MemoryLockBackend(), 'cleanup-node')
    let runs = 0
    const scheduler = new CleanupScheduler({ locks })
    scheduler.task('temp', {
      intervalMs: 50,
      lockKey: 'cleanup:temp',
      run: () => { runs += 1 }
    })
    scheduler.start()
    await new Promise(resolve => setTimeout(resolve, 130))
    await scheduler.stop()
    expect(runs).toBeGreaterThan(0)
    expect(scheduler.snapshots()[0]?.name).toBe('temp')
  })
})
