# Mesh Coordination Primitives

This chapter explains Mesh's distributed coordination layer.

## Why It Is Needed

If you have multiple backend or worker instances, you sometimes need rules like:

- do not let two nodes do the same work at the same time
- keep only one node as leader
- run cleanup jobs in a controlled way

Mesh provides locks, leader election, and cleanup scheduling for this.

## Locks

```ts
import { LockFactory } from '@panomapp/mesh/locks'

const locks = new LockFactory().createManager(config, 'worker-1')

await locks.runExclusive('media:123', async () => {
  await processMedia('123')
}, {
  ttlMs: 30000,
  waitMs: 5000
})
```

Use locks for:

- non-idempotent jobs
- preventing parallel access to the same resource
- protecting critical sections

## Lease Renewal

If a job runs for a long time, a one-time lock duration may not be enough. Lease renewal lets the job continue without losing the lock.

## Leader Election

```ts
import { LeaderElection } from '@panomapp/mesh/leader'

const leader = new LeaderElection(locks, 'worker-1')

await leader.runWhenLeader('cleanup', async (signal) => {
  while (!signal.aborted) {
    await doCleanup()
  }
})
```

This model is a good fit for:

- cron-like jobs
- sync tasks that must only run once
- app-wide background maintenance

## Cleanup Scheduler

```ts
import { CleanupScheduler } from '@panomapp/mesh/cleanup'

const cleanup = new CleanupScheduler({ locks, leader })

cleanup.task('temp-media', {
  intervalMs: 10 * 60_000,
  leader: true,
  lockKey: 'cleanup:temp-media',
  run: async () => {
    await deleteExpiredTempMedia()
  }
})

cleanup.start()
```

The scheduler does not perform domain work by itself; it only provides a safe execution rule.

## When to Use Which

- only one node at a time should enter: `lock`
- one node should keep leading: `leader election`
- run a periodic task safely: `cleanup scheduler`

## Next Step

[08 Podman And Quadlet](./08-podman-and-quadlet.md)
