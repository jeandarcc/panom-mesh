import path from 'node:path'
import { MeshConfigError } from '../core/errors.js'
import type {
  MeshConfig,
  MeshPortRange,
  MeshServiceConfig,
  NormalizedMeshConfig,
  NormalizedMeshRegistryConfig,
  NormalizedMeshRuntimeConfig,
  NormalizedMeshServiceConfig,
  NormalizedMeshRouterConfig,
  NormalizedMeshObservabilityConfig,
  NormalizedMeshStreamingConfig,
  NormalizedMeshCoordinationConfig,
  MeshHsmMappedRoute,
  NormalizedMeshHsmBridgeConfig
} from '../core/types.js'
import { HsmRouteMapper } from '../hsm/HsmRouteMapper.js'
import { HsmSchemaValidator } from '../hsm/HsmSchemaValidator.js'

const DEFAULT_PORT_RANGE: MeshPortRange = { from: 31_000, to: 32_999 }

export class MeshConfigNormalizer {
  public normalize(config: MeshConfig, projectRoot = process.cwd(), configPath = path.join(projectRoot, 'mesh.config.ts')): NormalizedMeshConfig {
    this.assertConfig(config)

    const runtime = this.normalizeRuntime(config, projectRoot)
    const router = this.normalizeRouter(config)
    const observability = this.normalizeObservability(config)
    const registry = this.normalizeRegistry(config, router)
    const streaming = this.normalizeStreaming(config, registry)
    const coordination = this.normalizeCoordination(config, registry, streaming)
    const hsm = this.normalizeHsm(config)
    const hsmRoutesByService = this.groupHsmRoutes(hsm.routes)
    const services = new Map<string, NormalizedMeshServiceConfig>()

    for (const [name, service] of Object.entries(config.services)) {
      services.set(name, this.normalizeService(name, service, runtime, projectRoot, hsmRoutesByService.get(name) ?? []))
    }

    return {
      app: config.app,
      projectRoot,
      configPath,
      router,
      observability,
      streaming,
      coordination,
      runtime,
      registry,
      hsm,
      services
    }
  }

  private normalizeHsm(config: MeshConfig): NormalizedMeshHsmBridgeConfig {
    const hsm = config.hsm
    const routeMode = hsm?.routeMode ?? 'both'
    const strict = hsm?.strict ?? false
    if (!hsm) {
      return { enabled: false, routeMode, strict, routes: [] }
    }
    if (routeMode !== 'canonical' && routeMode !== 'backend' && routeMode !== 'both') {
      throw new MeshConfigError('hsm.routeMode must be canonical, backend or both.')
    }
    const schema = hsm.schema
    if (!schema) {
      if (strict) throw new MeshConfigError('hsm.schema or hsm.schemaPath is required when hsm.strict is true.')
      return {
        enabled: false,
        ...(hsm.schemaPath !== undefined ? { schemaPath: hsm.schemaPath } : {}),
        routeMode,
        strict,
        routes: []
      }
    }
    const hsmValidator: HsmSchemaValidator = new HsmSchemaValidator()
    hsmValidator.assertValid(schema)
    const routes = new HsmRouteMapper().map({
      schema,
      routeMode,
      strict,
      mappings: hsm.mappings ?? [],
      services: config.services
    })
    return {
      enabled: true,
      schema,
      ...(hsm.schemaPath !== undefined ? { schemaPath: hsm.schemaPath } : {}),
      routeMode,
      strict,
      routes
    }
  }

  private groupHsmRoutes(routes: readonly MeshHsmMappedRoute[]): ReadonlyMap<string, readonly MeshHsmMappedRoute[]> {
    const grouped = new Map<string, MeshHsmMappedRoute[]>()
    for (const route of routes) {
      const existing = grouped.get(route.service) ?? []
      existing.push(route)
      grouped.set(route.service, existing)
    }
    return grouped
  }

  private normalizeRuntime(config: MeshConfig, projectRoot: string): NormalizedMeshRuntimeConfig {
    const runtime = config.runtime ?? {}
    return {
      mode: runtime.mode ?? 'process',
      podman: this.normalizePodman(config.app, runtime.podman ?? {}, projectRoot),
      stateDir: path.resolve(projectRoot, runtime.stateDir ?? '.mesh'),
      logsDir: path.resolve(projectRoot, runtime.logsDir ?? '.mesh/logs'),
      defaultWatch: runtime.defaultWatch ?? true,
      portRange: this.normalizePortRange(runtime.portRange ?? DEFAULT_PORT_RANGE, 'runtime.portRange'),
      drainTimeoutMs: runtime.drainTimeoutMs ?? 10_000,
      shutdownTimeoutMs: runtime.shutdownTimeoutMs ?? 8_000,
      killTimeoutMs: runtime.killTimeoutMs ?? 2_000
    }
  }


  private normalizePodman(app: string, podman: NonNullable<MeshConfig['runtime']>['podman'], projectRoot: string) {
    const prefix = podman?.containerPrefix ?? this.slug(app)
    return {
      podmanPath: podman?.podmanPath ?? 'podman',
      network: podman?.network ?? `${prefix}-mesh`,
      createNetwork: podman?.createNetwork ?? true,
      containerPrefix: prefix,
      routerImage: podman?.routerImage ?? 'ghcr.io/panomapp/mesh-router:latest',
      routerContainerPort: podman?.routerContainerPort ?? 8080,
      publishHost: podman?.publishHost ?? '127.0.0.1',
      replace: podman?.replace ?? true,
      pull: podman?.pull ?? 'missing',
      quadlet: {
        outputDir: path.resolve(projectRoot, podman?.quadlet?.outputDir ?? '.mesh/quadlet'),
        user: podman?.quadlet?.user ?? true,
        installCommand: podman?.quadlet?.installCommand ?? true
      },
      redis: {
        enabled: podman?.redis?.enabled ?? false,
        image: podman?.redis?.image ?? 'docker.io/redis:7-alpine',
        containerName: podman?.redis?.containerName ?? `${prefix}-redis`,
        port: podman?.redis?.port ?? 6379,
        volume: podman?.redis?.volume ?? `${prefix}-redis-data`
      }
    }
  }

  private normalizeRegistry(config: MeshConfig, router: NormalizedMeshRouterConfig): NormalizedMeshRegistryConfig {
    const registry = config.registry ?? {}
    const type = registry.type ?? (registry.url ? 'redis' : 'file')
    if (type === 'redis' && !registry.url) {
      throw new MeshConfigError('registry.url is required when registry.type is "redis".')
    }
    return {
      type,
      url: registry.url ?? '',
      ...(registry.keyPrefix !== undefined ? { keyPrefix: registry.keyPrefix } : {}),
      secret: registry.secret ?? router.secret,
      requireSignature: registry.requireSignature ?? type === 'redis',
      heartbeatIntervalMs: registry.heartbeatIntervalMs ?? 5_000,
      ttlMs: registry.ttlMs ?? 15_000,
      connectTimeoutMs: registry.connectTimeoutMs ?? 5_000
    }
  }


  private normalizeStreaming(config: MeshConfig, registry: NormalizedMeshRegistryConfig): NormalizedMeshStreamingConfig {
    const streaming = config.streaming ?? {}
    const transport = streaming.transport ?? (registry.type === 'redis' ? 'redis' : 'memory')
    if (transport !== 'memory' && transport !== 'redis') {
      throw new MeshConfigError('streaming.transport must be memory or redis.')
    }
    if (transport === 'redis' && !(streaming.url ?? registry.url)) {
      throw new MeshConfigError('streaming.url or registry.url is required when streaming.transport is "redis".')
    }
    const keyPrefix = streaming.keyPrefix ?? registry.keyPrefix ?? `mesh:${config.app}`
    return {
      enabled: streaming.enabled ?? registry.type === 'redis',
      transport,
      url: streaming.url ?? registry.url,
      keyPrefix,
      logs: streaming.logs ?? true,
      events: streaming.events ?? true,
      maxLogChunkBytes: streaming.maxLogChunkBytes ?? 32_768,
      connectTimeoutMs: streaming.connectTimeoutMs ?? registry.connectTimeoutMs
    }
  }


  private normalizeCoordination(config: MeshConfig, registry: NormalizedMeshRegistryConfig, streaming: NormalizedMeshStreamingConfig): NormalizedMeshCoordinationConfig {
    const coordination = config.coordination ?? {}
    const backend = coordination.backend ?? (registry.type === 'redis' ? 'redis' : 'memory')
    if (backend !== 'memory' && backend !== 'redis') {
      throw new MeshConfigError('coordination.backend must be memory or redis.')
    }
    const url = coordination.url ?? registry.url ?? streaming.url
    if (backend === 'redis' && !url) {
      throw new MeshConfigError('coordination.url or registry.url is required when coordination.backend is "redis".')
    }
    const keyPrefix = coordination.keyPrefix ?? registry.keyPrefix ?? streaming.keyPrefix ?? `mesh:${config.app}`
    const locks = coordination.locks ?? {}
    const lockBackend = locks.backend ?? backend
    const lockUrl = locks.url ?? url
    if (lockBackend === 'redis' && !lockUrl) {
      throw new MeshConfigError('coordination.locks.url or coordination.url is required when lock backend is "redis".')
    }
    const leader = coordination.leader ?? {}
    const cleanup = coordination.cleanup ?? {}
    const enabled = coordination.enabled ?? locks.enabled ?? leader.enabled ?? cleanup.enabled ?? backend === 'redis'
    return {
      enabled,
      backend,
      url,
      keyPrefix,
      connectTimeoutMs: coordination.connectTimeoutMs ?? registry.connectTimeoutMs,
      locks: {
        enabled: locks.enabled ?? enabled,
        backend: lockBackend,
        url: lockUrl,
        ttlMs: locks.ttlMs ?? 30_000,
        waitMs: locks.waitMs ?? 0
      },
      leader: {
        enabled: leader.enabled ?? enabled,
        ttlMs: leader.ttlMs ?? 30_000,
        renewEveryMs: leader.renewEveryMs ?? 10_000
      },
      cleanup: {
        enabled: cleanup.enabled ?? false
      }
    }
  }

  private normalizeObservability(config: MeshConfig): NormalizedMeshObservabilityConfig {
    const observability = config.observability ?? {}
    const rawPath = observability.path ?? '/_mesh'
    const path = rawPath === '/' ? '/_mesh' : `/${rawPath.replace(/^\/+|\/+$/g, '')}`
    return {
      enabled: observability.enabled ?? true,
      path,
      refreshIntervalMs: observability.refreshIntervalMs ?? 1_000,
      logLines: observability.logLines ?? 20,
      includeLogs: observability.includeLogs ?? false
    }
  }


  private normalizeRouter(config: MeshConfig): NormalizedMeshRouterConfig {
    const router = config.router ?? {}
    return {
      enabled: router.enabled ?? true,
      host: router.host ?? '127.0.0.1',
      port: router.port ?? 8080,
      sessionAffinity: router.sessionAffinity ?? true,
      cookieName: router.cookieName ?? 'pm_mesh',
      secret: router.secret ?? 'dev-only-mesh-secret',
      requestTimeoutMs: router.requestTimeoutMs ?? 30_000,
      secureCookies: router.secureCookies ?? false,
      drainTimeoutMs: router.drainTimeoutMs ?? 15_000,
      socketDrainTimeoutMs: router.socketDrainTimeoutMs ?? 10_000
    }
  }

  private normalizeService(
    name: string,
    service: MeshServiceConfig,
    runtime: NormalizedMeshRuntimeConfig,
    projectRoot: string,
    hsmRoutes: readonly MeshHsmMappedRoute[] = []
  ): NormalizedMeshServiceConfig {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
      throw new MeshConfigError(`Invalid service name "${name}". Use letters, numbers, _ or -.`)
    }

    const command = Array.isArray(service.command) ? service.command : [service.command]
    if (command.length === 0 || command.some(part => !part.trim())) {
      throw new MeshConfigError(`Service "${name}" must define a non-empty command.`)
    }

    const instances = service.instances ?? 1
    if (!Number.isInteger(instances) || instances < 0) {
      throw new MeshConfigError(`Service "${name}" instances must be a non-negative integer.`)
    }

    const configuredRoutes = service.route === undefined
      ? []
      : Array.isArray(service.route)
        ? service.route
        : [service.route]
    const routes = this.dedupeRoutes([...configuredRoutes, ...hsmRoutes.map(route => route.route)])

    for (const route of routes) {
      if (!route.startsWith('/')) {
        throw new MeshConfigError(`Service "${name}" route "${route}" must start with /.`)
      }
    }

    return {
      name,
      type: service.type ?? 'backend',
      command,
      ...(service.image !== undefined ? { image: service.image } : {}),
      podman: this.normalizeServicePodman(name, service),
      shell: typeof service.command === 'string',
      cwd: path.resolve(projectRoot, service.cwd ?? '.'),
      instances,
      ...(service.port !== undefined ? { port: service.port } : {}),
      portRange: this.normalizePortRange(service.portRange ?? runtime.portRange, `services.${name}.portRange`),
      routes,
      hsmRoutes,
      ...(service.healthPath !== undefined ? { healthPath: service.healthPath } : {}),
      strategy: service.strategy ?? 'round-robin',
      watch: service.watch ?? runtime.defaultWatch,
      env: this.normalizeEnv(service.env ?? {}),
      autoRestart: service.autoRestart ?? false,
      drainTimeoutMs: service.drainTimeoutMs ?? runtime.drainTimeoutMs,
      shutdownTimeoutMs: service.shutdownTimeoutMs ?? runtime.shutdownTimeoutMs
    }
  }

  private normalizeServicePodman(name: string, service: MeshServiceConfig) {
    const podman = service.podman ?? {}
    const toCommand = (value: string | readonly string[] | undefined): readonly string[] | undefined => {
      if (value === undefined) return undefined
      return typeof value === 'string' ? [value] : value
    }
    const containerPort = podman.containerPort ?? service.port ?? (service.type === 'frontend' ? 5173 : 3000)
    if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65_535) {
      throw new MeshConfigError(`Service "${name}" podman.containerPort must be a valid TCP port.`)
    }
    return {
      ...(podman.image !== undefined ? { image: podman.image } : {}),
      ...(toCommand(podman.command) !== undefined ? { command: toCommand(podman.command)! } : {}),
      ...(toCommand(podman.entrypoint) !== undefined ? { entrypoint: toCommand(podman.entrypoint)! } : {}),
      containerPort,
      publish: podman.publish ?? [],
      volumes: podman.volumes ?? [],
      labels: this.normalizeEnv(podman.labels ?? {}),
      env: this.normalizeEnv(podman.env ?? {}),
      user: podman.user ?? '',
      workdir: podman.workdir ?? '',
      restartPolicy: podman.restartPolicy ?? 'unless-stopped',
      networkAliases: podman.networkAliases ?? [],
      extraArgs: podman.extraArgs ?? []
    }
  }

  private dedupeRoutes(routes: readonly string[]): readonly string[] {
    const seen = new Set<string>()
    const output: string[] = []
    for (const route of routes) {
      const normalized = route.startsWith('/') ? (route === '/' ? '/' : `/${route.replace(/^\/+|\/+$/g, '')}`) : route
      if (seen.has(normalized)) continue
      seen.add(normalized)
      output.push(normalized)
    }
    output.sort((a, b) => b.length - a.length || a.localeCompare(b))
    return output
  }

  private slug(value: string): string {
    const slug = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
    return slug || 'mesh'
  }

  private normalizeEnv(env: Record<string, string | number | boolean | null | undefined>): Record<string, string> {
    const normalized: Record<string, string> = {}
    for (const [key, value] of Object.entries(env)) {
      if (value === null || value === undefined) continue
      normalized[key] = String(value)
    }
    return normalized
  }

  private normalizePortRange(range: MeshPortRange, field: string): MeshPortRange {
    if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 1 || range.to > 65_535 || range.from > range.to) {
      throw new MeshConfigError(`${field} must be a valid TCP port range.`)
    }
    return range
  }

  private assertConfig(config: MeshConfig): void {
    if (!config || typeof config !== 'object') throw new MeshConfigError('Mesh config must be an object.')
    if (!config.app || typeof config.app !== 'string') throw new MeshConfigError('Mesh config requires app name.')
    if (!config.services || typeof config.services !== 'object') throw new MeshConfigError('Mesh config requires services.')
  }
}
