export type MeshRuntimeMode = 'process' | 'podman'
export type MeshServiceType = 'frontend' | 'backend' | 'worker' | 'router'
export type MeshServiceStrategy = 'round-robin' | 'session-affinity' | 'least-connections'
export type MeshInstanceStatus = 'starting' | 'running' | 'draining' | 'stopped' | 'failed' | 'expired' | 'unknown'
export type MeshTlsMinVersion = 'TLSv1' | 'TLSv1.1' | 'TLSv1.2' | 'TLSv1.3'

export type MeshHsmRouteMode = 'canonical' | 'backend' | 'both'

export interface MeshHsmSchemaRouteIndexEntry {
  readonly stateId: string
  readonly pattern?: string
  readonly canonicalPattern?: string
  readonly kind?: string
  readonly isAlias?: boolean
  readonly redirectToCanonical?: boolean
  readonly priority?: number
  readonly score?: number
}

export interface MeshHsmSchemaStateIndexEntry {
  readonly id: string
  readonly key?: string
  readonly parentId?: string | null
  readonly depth?: number
  readonly tags?: readonly string[]
  readonly backend?: {
    readonly routes?: readonly string[]
    readonly methods?: readonly string[]
    readonly meta?: Record<string, unknown>
  }
}

export interface MeshHsmSchemaLike {
  readonly kind?: string
  readonly id?: string
  readonly version?: string
  readonly index?: {
    readonly states?: readonly MeshHsmSchemaStateIndexEntry[]
    readonly routes?: readonly MeshHsmSchemaRouteIndexEntry[]
    readonly tags?: readonly string[]
  }
}

export interface MeshHsmServiceBinding {
  readonly states?: readonly string[]
  readonly tags?: readonly string[]
  readonly includeCanonicalRoutes?: boolean
  readonly includeBackendRoutes?: boolean
  readonly routePrefix?: string
  readonly stripPrefix?: string
  readonly methods?: readonly string[]
}

export interface MeshHsmServiceMapping extends MeshHsmServiceBinding {
  readonly service: string
}

export interface MeshHsmBridgeConfig {
  /** Inline compiled HSM schema object. */
  readonly schema?: MeshHsmSchemaLike
  /** Path to a JSON/TS/JS module exporting a compiled HSM schema. Resolved relative to mesh.config.*. */
  readonly schemaPath?: string
  readonly routeMode?: MeshHsmRouteMode
  readonly strict?: boolean
  readonly mappings?: readonly MeshHsmServiceMapping[]
}

export interface MeshHsmMappedRoute {
  readonly service: string
  readonly route: string
  readonly source: 'hsm:canonical' | 'hsm:backend'
  readonly stateId: string
  readonly originalPattern: string
  readonly methods?: readonly string[]
}

export interface NormalizedMeshHsmBridgeConfig {
  readonly enabled: boolean
  readonly schema?: MeshHsmSchemaLike
  readonly schemaPath?: string
  readonly routeMode: MeshHsmRouteMode
  readonly strict: boolean
  readonly routes: readonly MeshHsmMappedRoute[]
}

export interface MeshPortRange {
  readonly from: number
  readonly to: number
}

export interface MeshRouterConfig {
  readonly enabled?: boolean
  readonly host?: string
  readonly port?: number
  readonly sessionAffinity?: boolean
  readonly cookieName?: string
  readonly secret?: string
  readonly requestTimeoutMs?: number
  readonly secureCookies?: boolean
  readonly drainTimeoutMs?: number
  readonly socketDrainTimeoutMs?: number
  readonly tls?: MeshRouterTlsConfig
}

export interface MeshRouterTlsConfig {
  readonly enabled?: boolean
  readonly certPath?: string
  readonly keyPath?: string
  readonly caPath?: string
  readonly passphraseEnv?: string
  readonly minVersion?: MeshTlsMinVersion
  readonly additionalPorts?: readonly number[]
}

export type MeshRegistryType = 'file' | 'redis'
export type MeshStreamTransport = 'memory' | 'redis'
export type MeshCoordinationBackend = 'memory' | 'redis'


export interface MeshCoordinationLocksConfig {
  readonly enabled?: boolean
  readonly backend?: MeshCoordinationBackend
  readonly url?: string
  readonly ttlMs?: number
  readonly waitMs?: number
}

export interface MeshCoordinationLeaderConfig {
  readonly enabled?: boolean
  readonly ttlMs?: number
  readonly renewEveryMs?: number
}

export interface MeshCoordinationCleanupConfig {
  readonly enabled?: boolean
}

export interface MeshCoordinationConfig {
  readonly enabled?: boolean
  readonly backend?: MeshCoordinationBackend
  readonly url?: string
  readonly keyPrefix?: string
  readonly connectTimeoutMs?: number
  readonly locks?: MeshCoordinationLocksConfig
  readonly leader?: MeshCoordinationLeaderConfig
  readonly cleanup?: MeshCoordinationCleanupConfig
}

export interface MeshRegistryConfig {
  readonly type?: MeshRegistryType
  readonly url?: string
  readonly keyPrefix?: string
  readonly secret?: string
  readonly requireSignature?: boolean
  readonly heartbeatIntervalMs?: number
  readonly ttlMs?: number
  readonly connectTimeoutMs?: number
}

export interface MeshPodmanRedisConfig {
  readonly enabled?: boolean
  readonly image?: string
  readonly containerName?: string
  readonly port?: number
  readonly volume?: string
}

export interface MeshPodmanQuadletConfig {
  readonly outputDir?: string
  readonly user?: boolean
  readonly installCommand?: boolean
  readonly configSourceDir?: string
  readonly configTargetDir?: string
}

export interface MeshPodmanRuntimeConfig {
  readonly podmanPath?: string
  readonly network?: string
  readonly createNetwork?: boolean
  readonly containerPrefix?: string
  readonly routerImage?: string
  readonly routerContainerPort?: number
  readonly publishHost?: string
  readonly replace?: boolean
  readonly pull?: 'never' | 'missing' | 'always'
  readonly quadlet?: MeshPodmanQuadletConfig
  readonly redis?: MeshPodmanRedisConfig
}

export interface MeshServicePodmanConfig {
  readonly image?: string
  readonly command?: string | readonly string[]
  readonly entrypoint?: string | readonly string[]
  readonly containerPort?: number
  readonly publish?: readonly string[]
  readonly volumes?: readonly string[]
  readonly labels?: Record<string, string | number | boolean | null | undefined>
  readonly env?: Record<string, string | number | boolean | null | undefined>
  readonly user?: string
  readonly workdir?: string
  readonly restartPolicy?: string
  readonly networkAliases?: readonly string[]
  readonly extraArgs?: readonly string[]
}

export interface MeshObservabilityConfig {
  readonly enabled?: boolean
  readonly path?: string
  readonly refreshIntervalMs?: number
  readonly logLines?: number
  readonly includeLogs?: boolean
}

export interface MeshStreamingConfig {
  readonly enabled?: boolean
  readonly transport?: MeshStreamTransport
  readonly url?: string
  readonly keyPrefix?: string
  readonly logs?: boolean
  readonly events?: boolean
  readonly maxLogChunkBytes?: number
  readonly connectTimeoutMs?: number
}

export interface MeshRuntimeConfig {
  readonly mode?: MeshRuntimeMode
  readonly podman?: MeshPodmanRuntimeConfig
  readonly stateDir?: string
  readonly logsDir?: string
  readonly defaultWatch?: boolean
  readonly portRange?: MeshPortRange
  readonly drainTimeoutMs?: number
  readonly shutdownTimeoutMs?: number
  readonly killTimeoutMs?: number
}

export interface MeshServiceConfig {
  readonly type?: MeshServiceType
  readonly command: string | readonly string[]
  readonly image?: string
  readonly podman?: MeshServicePodmanConfig
  readonly cwd?: string
  readonly instances?: number
  readonly port?: number
  readonly portRange?: MeshPortRange
  readonly route?: string | readonly string[]
  readonly healthPath?: string
  readonly strategy?: MeshServiceStrategy
  readonly hsm?: MeshHsmServiceBinding
  readonly watch?: boolean
  readonly env?: Record<string, string | number | boolean | null | undefined>
  readonly autoRestart?: boolean
  readonly drainTimeoutMs?: number
  readonly shutdownTimeoutMs?: number
}

export interface MeshConfig {
  readonly app: string
  readonly router?: MeshRouterConfig
  readonly observability?: MeshObservabilityConfig
  readonly runtime?: MeshRuntimeConfig
  readonly registry?: MeshRegistryConfig
  readonly hsm?: MeshHsmBridgeConfig
  readonly streaming?: MeshStreamingConfig
  readonly coordination?: MeshCoordinationConfig
  readonly services: Record<string, MeshServiceConfig>
}


export interface NormalizedMeshCoordinationLocksConfig {
  readonly enabled: boolean
  readonly backend: MeshCoordinationBackend
  readonly url: string
  readonly ttlMs: number
  readonly waitMs: number
}

export interface NormalizedMeshCoordinationLeaderConfig {
  readonly enabled: boolean
  readonly ttlMs: number
  readonly renewEveryMs: number
}

export interface NormalizedMeshCoordinationCleanupConfig {
  readonly enabled: boolean
}

export interface NormalizedMeshCoordinationConfig {
  readonly enabled: boolean
  readonly backend: MeshCoordinationBackend
  readonly url: string
  readonly keyPrefix: string
  readonly connectTimeoutMs: number
  readonly locks: NormalizedMeshCoordinationLocksConfig
  readonly leader: NormalizedMeshCoordinationLeaderConfig
  readonly cleanup: NormalizedMeshCoordinationCleanupConfig
}

export interface NormalizedMeshObservabilityConfig {
  readonly enabled: boolean
  readonly path: string
  readonly refreshIntervalMs: number
  readonly logLines: number
  readonly includeLogs: boolean
}

export interface NormalizedMeshStreamingConfig {
  readonly enabled: boolean
  readonly transport: MeshStreamTransport
  readonly url: string
  readonly keyPrefix: string
  readonly logs: boolean
  readonly events: boolean
  readonly maxLogChunkBytes: number
  readonly connectTimeoutMs: number
}

export interface NormalizedMeshRouterConfig {
  readonly enabled: boolean
  readonly host: string
  readonly port: number
  readonly sessionAffinity: boolean
  readonly cookieName: string
  readonly secret: string
  readonly requestTimeoutMs: number
  readonly secureCookies: boolean
  readonly drainTimeoutMs: number
  readonly socketDrainTimeoutMs: number
  readonly protocol: 'http' | 'https'
  readonly publicOrigin: string
  readonly publicOrigins: readonly string[]
  readonly tls: NormalizedMeshRouterTlsConfig
}

export interface NormalizedMeshRouterTlsConfig {
  readonly enabled: boolean
  readonly certPath?: string
  readonly keyPath?: string
  readonly caPath?: string
  readonly passphraseEnv?: string
  readonly minVersion?: MeshTlsMinVersion
  readonly additionalPorts: readonly number[]
}

export interface NormalizedMeshRegistryConfig {
  readonly type: MeshRegistryType
  readonly url: string
  readonly keyPrefix?: string
  readonly secret?: string
  readonly requireSignature: boolean
  readonly heartbeatIntervalMs: number
  readonly ttlMs: number
  readonly connectTimeoutMs: number
}

export interface NormalizedMeshPodmanRuntimeConfig {
  readonly podmanPath: string
  readonly network: string
  readonly createNetwork: boolean
  readonly containerPrefix: string
  readonly routerImage: string
  readonly routerContainerPort: number
  readonly publishHost: string
  readonly replace: boolean
  readonly pull: 'never' | 'missing' | 'always'
  readonly quadlet: Required<MeshPodmanQuadletConfig>
  readonly redis: Required<MeshPodmanRedisConfig>
}

export interface NormalizedMeshRuntimeConfig {
  readonly mode: MeshRuntimeMode
  readonly podman: NormalizedMeshPodmanRuntimeConfig
  readonly stateDir: string
  readonly logsDir: string
  readonly defaultWatch: boolean
  readonly portRange: MeshPortRange
  readonly drainTimeoutMs: number
  readonly shutdownTimeoutMs: number
  readonly killTimeoutMs: number
}

export interface NormalizedMeshServiceConfig {
  readonly name: string
  readonly type: MeshServiceType
  readonly command: readonly string[]
  readonly image?: string
  readonly podman: Required<Omit<MeshServicePodmanConfig, 'image' | 'command' | 'entrypoint'>> & {
    readonly image?: string
    readonly command?: readonly string[]
    readonly entrypoint?: readonly string[]
  }
  readonly shell: boolean
  readonly cwd: string
  readonly instances: number
  readonly port?: number
  readonly portRange: MeshPortRange
  readonly routes: readonly string[]
  readonly hsmRoutes: readonly MeshHsmMappedRoute[]
  readonly healthPath?: string
  readonly strategy: MeshServiceStrategy
  readonly watch: boolean
  readonly env: Record<string, string>
  readonly autoRestart: boolean
  readonly drainTimeoutMs: number
  readonly shutdownTimeoutMs: number
}

export interface NormalizedMeshConfig {
  readonly app: string
  readonly projectRoot: string
  readonly configPath: string
  readonly router: NormalizedMeshRouterConfig
  readonly observability: NormalizedMeshObservabilityConfig
  readonly streaming: NormalizedMeshStreamingConfig
  readonly coordination: NormalizedMeshCoordinationConfig
  readonly runtime: NormalizedMeshRuntimeConfig
  readonly registry: NormalizedMeshRegistryConfig
  readonly hsm: NormalizedMeshHsmBridgeConfig
  readonly services: ReadonlyMap<string, NormalizedMeshServiceConfig>
}

export interface MeshConnectionCounters {
  readonly http: number
  readonly sockets: number
  readonly total: number
}

export interface MeshInstanceRecord {
  readonly id: string
  readonly service: string
  readonly serviceType: MeshServiceType
  readonly status: MeshInstanceStatus
  readonly pid: number | null
  readonly port: number | null
  readonly host: string
  readonly url: string | null
  readonly command: readonly string[]
  readonly cwd: string
  readonly logFile: string
  readonly startedAt: string
  readonly lastSeenAt?: string
  readonly expiresAt?: string
  readonly stoppedAt?: string
  readonly exitCode?: number | null
  readonly signal?: NodeJS.Signals | null
  readonly metadata?: Record<string, unknown>
}

export interface MeshStateFile {
  readonly version: 1
  readonly app: string
  readonly updatedAt: string
  readonly instances: readonly MeshInstanceRecord[]
}

export interface MeshPodmanGenerateOptions {
  readonly outputDir?: string
  readonly force?: boolean
  readonly print?: boolean
}

export interface MeshPodmanPlanOptions {
  readonly json?: boolean
}

export interface MeshHsmPlanOptions {
  readonly json?: boolean
}

export interface MeshRunOptions {
  readonly services?: readonly string[]
  readonly all?: boolean
  readonly instances?: number
  readonly watch?: boolean
  readonly detach?: boolean
  readonly router?: boolean
  readonly cliPath?: string
}

export interface MeshPsOptions {
  readonly json?: boolean
}

export interface MeshWatchOptions {
  readonly lines?: number
  readonly stream?: boolean
}

export interface MeshStopOptions {
  readonly drainTimeoutMs?: number
  readonly shutdownTimeoutMs?: number
  readonly killTimeoutMs?: number
  readonly force?: boolean
}
