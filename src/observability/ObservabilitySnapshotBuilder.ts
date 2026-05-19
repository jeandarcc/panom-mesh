import http from 'node:http'
import type { MeshInstanceRecord, NormalizedMeshConfig } from '../core/types.js'
import { RegistryFactory } from '../registry/RegistryFactory.js'
import { LogStore } from '../logs/LogStore.js'
import type { MeshRegistry } from '../registry/types.js'
import { LockFactory } from '../locks/LockFactory.js'
import { LeaderElection } from '../leader/LeaderElection.js'
import type { MeshDashboardBuildOptions, MeshDashboardLogEntry, MeshDashboardRouteSummary, MeshDashboardServiceSummary, MeshDashboardSnapshot, MeshRouterMetricsSnapshot } from './types.js'

export class ObservabilitySnapshotBuilder {
  private readonly registry: MeshRegistry
  private readonly logs: LogStore

  public constructor(private readonly config: NormalizedMeshConfig) {
    this.registry = new RegistryFactory().create(config)
    this.logs = new LogStore(config.runtime.logsDir)
  }

  public async build(options: MeshDashboardBuildOptions = {}): Promise<MeshDashboardSnapshot> {
    const instances = await this.registry.list({ includeExpired: true })
    const routerUrl = `http://${this.config.router.host}:${this.config.router.port}`
    const metricsPath = `${this.config.observability.path}/metrics`
    const metrics = await this.readRouterMetrics(`${routerUrl}${metricsPath}`)
    const serviceSummaries = this.serviceSummaries(instances)
    const routes = this.routeSummaries()
    const logs = options.includeLogs ? await this.readLogs(instances, options.logLines ?? this.config.observability.logLines) : undefined
    const coordination = await this.readCoordination()

    return {
      app: this.config.app,
      generatedAt: new Date().toISOString(),
      projectRoot: this.config.projectRoot,
      router: {
        enabled: this.config.router.enabled,
        url: routerUrl,
        metricsPath,
        ...(metrics.ok ? { metrics: metrics.value } : { metricsError: metrics.error })
      },
      registry: {
        type: this.config.registry.type,
        ttlMs: this.config.registry.ttlMs,
        heartbeatIntervalMs: this.config.registry.heartbeatIntervalMs
      },
      streaming: {
        enabled: this.config.streaming.enabled,
        transport: this.config.streaming.transport,
        logs: this.config.streaming.logs,
        events: this.config.streaming.events,
        keyPrefix: this.config.streaming.keyPrefix
      },
      services: serviceSummaries,
      instances,
      routes,
      coordination,
      hsm: {
        enabled: this.config.hsm.enabled,
        routeCount: this.config.hsm.routes.length,
        ...(this.config.hsm.schema?.id !== undefined ? { schemaId: this.config.hsm.schema.id } : {}),
        ...(this.config.hsm.schema?.version !== undefined ? { schemaVersion: this.config.hsm.schema.version } : {})
      },
      ...(logs ? { logs } : {})
    }
  }

  private serviceSummaries(instances: readonly MeshInstanceRecord[]): readonly MeshDashboardServiceSummary[] {
    const summaries: MeshDashboardServiceSummary[] = []
    for (const service of this.config.services.values()) {
      const owned = instances.filter(instance => instance.service === service.name)
      summaries.push({
        service: service.name,
        type: service.type,
        strategy: service.strategy,
        configuredInstances: service.instances,
        running: owned.filter(instance => instance.status === 'running' || instance.status === 'starting').length,
        draining: owned.filter(instance => instance.status === 'draining').length,
        expired: owned.filter(instance => instance.status === 'expired').length,
        failed: owned.filter(instance => instance.status === 'failed').length,
        routes: service.routes
      })
    }
    summaries.sort((a, b) => a.service.localeCompare(b.service))
    return summaries
  }

  private routeSummaries(): readonly MeshDashboardRouteSummary[] {
    const routes: MeshDashboardRouteSummary[] = []
    for (const service of this.config.services.values()) {
      const hsmRoutes = new Set(service.hsmRoutes.map(route => route.route))
      for (const route of service.routes) {
        if (hsmRoutes.has(route)) continue
        routes.push({ service: service.name, route, source: 'config' })
      }
      for (const route of service.hsmRoutes) {
        routes.push({ service: service.name, route: route.route, source: route.source, stateId: route.stateId })
      }
    }
    routes.sort((a, b) => b.route.length - a.route.length || a.service.localeCompare(b.service) || a.route.localeCompare(b.route))
    return routes
  }


  private async readCoordination() {
    if (!this.config.coordination.enabled) {
      return { enabled: false, backend: this.config.coordination.backend, locks: [], leaders: [] }
    }
    try {
      const locks = new LockFactory().createManager(this.config, 'dashboard')
      const leader = new LeaderElection(locks, 'dashboard')
      return {
        enabled: true,
        backend: this.config.coordination.locks.backend,
        locks: await locks.list(),
        leaders: await leader.list()
      }
    } catch (error) {
      return {
        enabled: true,
        backend: this.config.coordination.locks.backend,
        locks: [],
        leaders: [],
        errors: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  private async readLogs(instances: readonly MeshInstanceRecord[], lines: number): Promise<readonly MeshDashboardLogEntry[]> {
    const selected = instances
      .filter(instance => instance.logFile)
      .sort((a, b) => a.service.localeCompare(b.service) || a.id.localeCompare(b.id))
    const output: MeshDashboardLogEntry[] = []
    for (const instance of selected) {
      const text = await this.logs.readLastLines(instance.logFile, lines)
      output.push({ instanceId: instance.id, service: instance.service, logFile: instance.logFile, text })
    }
    return output
  }

  private async readRouterMetrics(url: string): Promise<{ ok: true; value: MeshRouterMetricsSnapshot } | { ok: false; error: string }> {
    return await new Promise(resolve => {
      const request = http.request(url, { method: 'GET', timeout: 750 }, response => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', chunk => { body += String(chunk) })
        response.on('end', () => {
          try {
            if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
              resolve({ ok: false, error: `router metrics returned HTTP ${response.statusCode ?? 'unknown'}` })
              return
            }
            resolve({ ok: true, value: JSON.parse(body) as MeshRouterMetricsSnapshot })
          } catch (error) {
            resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        })
      })
      request.once('timeout', () => {
        request.destroy()
        resolve({ ok: false, error: 'router metrics timed out' })
      })
      request.once('error', error => resolve({ ok: false, error: error.message }))
      request.end()
    })
  }
}
