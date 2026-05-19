import type { MeshConnectionCounters, MeshInstanceRecord, MeshServiceStrategy, MeshServiceType } from '../core/types.js'
import type { MeshLockRecord } from '../locks/types.js'
import type { MeshLeaderRecord } from '../leader/types.js'

export interface MeshRouterServiceStats {
  readonly service: string
  readonly requests: number
  readonly upgrades: number
  readonly errors: number
  readonly active: MeshConnectionCounters
}

export interface MeshRouterMetricsSnapshot {
  readonly router: {
    readonly startedAt: string
    readonly uptimeMs: number
    readonly draining: boolean
  }
  readonly requests: {
    readonly total: number
    readonly proxied: number
    readonly noTarget: number
    readonly errors: number
    readonly upgrades: number
  }
  readonly active: MeshConnectionCounters
  readonly services: readonly MeshRouterServiceStats[]
}

export interface MeshDashboardServiceSummary {
  readonly service: string
  readonly type: MeshServiceType
  readonly strategy: MeshServiceStrategy
  readonly configuredInstances: number
  readonly running: number
  readonly draining: number
  readonly expired: number
  readonly failed: number
  readonly routes: readonly string[]
}

export interface MeshDashboardRouteSummary {
  readonly service: string
  readonly route: string
  readonly source: 'config' | 'hsm:canonical' | 'hsm:backend'
  readonly stateId?: string
}

export interface MeshDashboardLogEntry {
  readonly instanceId: string
  readonly service: string
  readonly logFile: string
  readonly text: string
}


export interface MeshDashboardCoordinationSnapshot {
  readonly enabled: boolean
  readonly backend: string
  readonly locks: readonly MeshLockRecord[]
  readonly leaders: readonly MeshLeaderRecord[]
  readonly errors?: readonly string[]
}

export interface MeshDashboardSnapshot {
  readonly app: string
  readonly generatedAt: string
  readonly projectRoot: string
  readonly router: {
    readonly enabled: boolean
    readonly url: string
    readonly metricsPath: string
    readonly metrics?: MeshRouterMetricsSnapshot
    readonly metricsError?: string
  }
  readonly registry: {
    readonly type: string
    readonly ttlMs: number
    readonly heartbeatIntervalMs: number
  }
  readonly streaming: {
    readonly enabled: boolean
    readonly transport: string
    readonly logs: boolean
    readonly events: boolean
    readonly keyPrefix: string
  }
  readonly services: readonly MeshDashboardServiceSummary[]
  readonly instances: readonly MeshInstanceRecord[]
  readonly routes: readonly MeshDashboardRouteSummary[]
  readonly coordination: MeshDashboardCoordinationSnapshot
  readonly hsm: {
    readonly enabled: boolean
    readonly routeCount: number
    readonly schemaId?: string
    readonly schemaVersion?: string
  }
  readonly logs?: readonly MeshDashboardLogEntry[]
}

export interface MeshDashboardBuildOptions {
  readonly includeLogs?: boolean
  readonly logLines?: number
}

export interface MeshDashboardRenderOptions {
  readonly colors?: boolean
  readonly compact?: boolean
}

export interface MeshDashboardCommandOptions extends MeshDashboardBuildOptions, MeshDashboardRenderOptions {
  readonly json?: boolean
  readonly once?: boolean
  readonly intervalMs?: number
}
