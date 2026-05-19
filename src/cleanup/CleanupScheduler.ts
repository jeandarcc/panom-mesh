import { sleep } from '../utils/time.js'
import type { LeaderElection } from '../leader/LeaderElection.js'
import type { LockManager } from '../locks/LockManager.js'
import type { MeshCleanupTaskOptions, MeshCleanupTaskSnapshot, MeshCleanupTaskStatus } from './types.js'

interface RegisteredTask {
  readonly name: string
  readonly options: MeshCleanupTaskOptions
  status: MeshCleanupTaskStatus
  runs: number
  failures: number
  lastRunAt?: string
  nextRunAt?: string
  lastDurationMs?: number
  lastError?: string
  controller?: AbortController
}

export class CleanupScheduler {
  private readonly tasks = new Map<string, RegisteredTask>()
  private stopped = false

  public constructor(private readonly deps: { readonly locks?: LockManager; readonly leader?: LeaderElection } = {}) {}

  public task(name: string, options: MeshCleanupTaskOptions): this {
    if (!name.trim()) throw new Error('Cleanup task name is required.')
    if (!Number.isFinite(options.intervalMs) || options.intervalMs < 1) throw new Error(`Cleanup task "${name}" intervalMs must be positive.`)
    this.tasks.set(name, { name, options, status: 'idle', runs: 0, failures: 0 })
    return this
  }

  public start(): void {
    for (const task of this.tasks.values()) this.schedule(task, task.options.initialDelayMs ?? 0)
  }

  public async stop(): Promise<void> {
    this.stopped = true
    for (const task of this.tasks.values()) {
      task.status = 'stopped'
      task.controller?.abort()
    }
  }

  public snapshots(): readonly MeshCleanupTaskSnapshot[] {
    return Array.from(this.tasks.values()).map(task => ({
      name: task.name,
      status: task.status,
      intervalMs: task.options.intervalMs,
      ...(task.lastRunAt ? { lastRunAt: task.lastRunAt } : {}),
      ...(task.nextRunAt ? { nextRunAt: task.nextRunAt } : {}),
      ...(task.lastDurationMs !== undefined ? { lastDurationMs: task.lastDurationMs } : {}),
      ...(task.lastError ? { lastError: task.lastError } : {}),
      runs: task.runs,
      failures: task.failures
    })).sort((a, b) => a.name.localeCompare(b.name))
  }

  private schedule(task: RegisteredTask, delayMs: number): void {
    if (this.stopped) return
    const jitter = task.options.jitterMs ? Math.floor(Math.random() * task.options.jitterMs) : 0
    const wait = Math.max(0, delayMs + jitter)
    task.nextRunAt = new Date(Date.now() + wait).toISOString()
    const timer = setTimeout(() => { void this.runTask(task) }, wait)
    timer.unref?.()
  }

  private async runTask(task: RegisteredTask): Promise<void> {
    if (this.stopped) return
    const started = Date.now()
    const controller = new AbortController()
    task.controller = controller
    task.status = 'running'
    task.lastRunAt = new Date(started).toISOString()
    let timeout: NodeJS.Timeout | null = null
    if (task.options.maxRuntimeMs) {
      timeout = setTimeout(() => controller.abort(), task.options.maxRuntimeMs)
      timeout.unref?.()
    }

    try {
      await this.runProtected(task, controller)
      task.status = 'succeeded'
      task.runs += 1
      delete task.lastError
    } catch (error) {
      task.status = 'failed'
      task.failures += 1
      task.lastError = error instanceof Error ? error.message : String(error)
    } finally {
      if (timeout) clearTimeout(timeout)
      delete task.controller
      task.lastDurationMs = Date.now() - started
      if (!this.stopped) this.schedule(task, task.options.intervalMs)
    }
  }

  private async runProtected(task: RegisteredTask, controller: AbortController): Promise<void> {
    const leaderGroup = typeof task.options.leader === 'string' ? task.options.leader : task.options.leader ? `cleanup:${task.name}` : undefined
    const lockKey = task.options.lockKey ?? (task.options.leader ? undefined : `cleanup:${task.name}`)
    const execute = async (): Promise<void> => {
      await task.options.run({ task: task.name, signal: controller.signal, startedAt: new Date() })
    }
    if (leaderGroup) {
      if (!this.deps.leader) throw new Error(`Cleanup task "${task.name}" requires a leader election dependency.`)
      const result = await this.deps.leader.runWhenLeader(leaderGroup, async signal => {
        signal.addEventListener('abort', () => controller.abort(), { once: true })
        await execute()
      }, { ttlMs: Math.max(task.options.intervalMs * 2, 30_000), metadata: { task: task.name } })
      if (result === null) task.status = 'skipped'
      return
    }
    if (lockKey) {
      if (!this.deps.locks) throw new Error(`Cleanup task "${task.name}" requires a lock dependency.`)
      await this.deps.locks.runExclusive(lockKey, async () => execute(), { ttlMs: Math.max(task.options.intervalMs * 2, 30_000), waitMs: 0, metadata: { task: task.name, kind: 'cleanup' } })
      return
    }
    await execute()
  }
}

export async function sleepForCleanup(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const abort = (): void => {
      clearTimeout(timer)
      reject(new Error('Cleanup sleep aborted.'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}
