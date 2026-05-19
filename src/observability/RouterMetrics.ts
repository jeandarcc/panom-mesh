import type { MeshConnectionCounters } from '../core/types.js'
import type { MeshRouterMetricsSnapshot, MeshRouterServiceStats } from './types.js'

interface MutableServiceStats {
  service: string
  requests: number
  upgrades: number
  errors: number
}

export class RouterMetrics {
  private readonly startedAt = new Date()
  private requestsTotal = 0
  private proxiedTotal = 0
  private noTargetTotal = 0
  private errorsTotal = 0
  private upgradesTotal = 0
  private readonly services = new Map<string, MutableServiceStats>()

  public recordProxy(service: string): void {
    this.requestsTotal += 1
    this.proxiedTotal += 1
    this.service(service).requests += 1
  }

  public recordUpgrade(service: string): void {
    this.requestsTotal += 1
    this.proxiedTotal += 1
    this.upgradesTotal += 1
    const stats = this.service(service)
    stats.requests += 1
    stats.upgrades += 1
  }

  public recordNoTarget(): void {
    this.requestsTotal += 1
    this.noTargetTotal += 1
  }

  public recordError(service?: string): void {
    this.errorsTotal += 1
    if (service) this.service(service).errors += 1
  }

  public snapshot(active: MeshConnectionCounters, serviceActive: ReadonlyMap<string, MeshConnectionCounters>, draining: boolean): MeshRouterMetricsSnapshot {
    const services: MeshRouterServiceStats[] = []
    for (const stats of this.services.values()) {
      services.push({
        service: stats.service,
        requests: stats.requests,
        upgrades: stats.upgrades,
        errors: stats.errors,
        active: serviceActive.get(stats.service) ?? { http: 0, sockets: 0, total: 0 }
      })
    }
    services.sort((a, b) => a.service.localeCompare(b.service))
    return {
      router: {
        startedAt: this.startedAt.toISOString(),
        uptimeMs: Date.now() - this.startedAt.getTime(),
        draining
      },
      requests: {
        total: this.requestsTotal,
        proxied: this.proxiedTotal,
        noTarget: this.noTargetTotal,
        errors: this.errorsTotal,
        upgrades: this.upgradesTotal
      },
      active,
      services
    }
  }

  private service(service: string): MutableServiceStats {
    const existing = this.services.get(service)
    if (existing) return existing
    const created: MutableServiceStats = { service, requests: 0, upgrades: 0, errors: 0 }
    this.services.set(service, created)
    return created
  }
}
