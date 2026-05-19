export interface MeshLeaderRunOptions {
  readonly ttlMs?: number
  readonly renewEveryMs?: number
  readonly waitMs?: number
  readonly metadata?: Record<string, unknown>
}

export interface MeshLeaderRecord {
  readonly group: string
  readonly leaderId: string
  readonly acquiredAt: string
  readonly expiresAt: string
  readonly metadata?: Record<string, unknown>
}

export interface MeshLeaderHandle {
  readonly group: string
  readonly leaderId: string
  readonly acquiredAt: string
  readonly expiresAt: string
  release(): Promise<boolean>
}
