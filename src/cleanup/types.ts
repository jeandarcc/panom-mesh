export interface MeshCleanupTaskOptions {
  readonly intervalMs: number
  readonly initialDelayMs?: number
  readonly jitterMs?: number
  readonly maxRuntimeMs?: number
  readonly leader?: boolean | string
  readonly lockKey?: string
  readonly run: (context: MeshCleanupTaskContext) => Promise<void> | void
}

export interface MeshCleanupTaskContext {
  readonly task: string
  readonly signal: AbortSignal
  readonly startedAt: Date
}

export type MeshCleanupTaskStatus = 'idle' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'stopped'

export interface MeshCleanupTaskSnapshot {
  readonly name: string
  readonly status: MeshCleanupTaskStatus
  readonly intervalMs: number
  readonly lastRunAt?: string
  readonly nextRunAt?: string
  readonly lastDurationMs?: number
  readonly lastError?: string
  readonly runs: number
  readonly failures: number
}
