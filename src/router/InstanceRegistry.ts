import http from 'node:http'
import type { MeshInstanceRecord, NormalizedMeshConfig } from '../core/types.js'
import { RegistryFactory } from '../registry/RegistryFactory.js'
import { RegistryRecordTools } from '../registry/RegistryRecordTools.js'
import type { MeshRegistry } from '../registry/types.js'

interface HealthState {
  healthy: boolean
  checkedAt: number
  consecutiveFailures: number
  lastHealthyAt: number | null
}

export class InstanceRegistry {
  private readonly registry: MeshRegistry
  private readonly healthCache = new Map<string, HealthState>()

  public constructor(private readonly config: NormalizedMeshConfig) {
    this.registry = new RegistryFactory().create(config)
  }

  public async listRoutable(): Promise<readonly MeshInstanceRecord[]> {
    const records = await this.registry.list()
    return records.filter(instance => RegistryRecordTools.isRoutable(instance))
  }

  public async listHealthyByService(service: string): Promise<readonly MeshInstanceRecord[]> {
    const instances = (await this.listRoutable()).filter(instance => instance.service === service)
    const serviceConfig = this.config.services.get(service)
    if (!serviceConfig?.healthPath) return instances

    const results = await Promise.all(instances.map(async instance => ({
      instance,
      healthy: await this.checkHttpHealth(instance, serviceConfig.healthPath!)
    })))
    return results.filter(result => result.healthy).map(result => result.instance)
  }

  private checkStartingGrace(instance: MeshInstanceRecord): boolean {
    const graceMs = this.config.router.health.startingGraceMs
    if (graceMs <= 0 || !instance.startedAt) return false
    const startedAt = new Date(instance.startedAt).getTime()
    if (Number.isNaN(startedAt)) return false
    return Date.now() - startedAt <= graceMs
  }

  private async checkHttpHealth(instance: MeshInstanceRecord, healthPath: string): Promise<boolean> {
    if (!instance.url) return false

    const health = this.config.router.health
    const cached = this.healthCache.get(instance.id)
    const now = Date.now()
    if (cached && now - cached.checkedAt < health.cacheMs) {
      return cached.healthy
    }

    if (this.checkStartingGrace(instance)) {
      this.setHealthState(instance.id, { healthy: true, checkedAt: now, consecutiveFailures: 0, lastHealthyAt: now })
      return true
    }

    const target = new URL(healthPath, instance.url)
    const probeHealthy = await new Promise<boolean>(resolve => {
      const req = http.request(target, { method: 'GET', timeout: health.checkTimeoutMs }, res => {
        res.resume()
        resolve((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 500)
      })
      req.on('timeout', () => {
        req.destroy()
        resolve(false)
      })
      req.on('error', () => resolve(false))
      req.end()
    })

    const previous = cached ?? { healthy: true, checkedAt: 0, consecutiveFailures: 0, lastHealthyAt: now }
    const consecutiveFailures = probeHealthy ? 0 : previous.consecutiveFailures + 1
    const lastHealthyAt = probeHealthy ? now : (previous.lastHealthyAt ?? null)

    let healthy = probeHealthy
    if (!probeHealthy) {
      if (
        previous.lastHealthyAt !== null &&
        now - previous.lastHealthyAt <= health.staleGraceMs
      ) {
        healthy = true
      } else if (consecutiveFailures < health.failureThreshold) {
        healthy = previous.healthy
      } else {
        healthy = false
      }
    }

    this.setHealthState(instance.id, { healthy, checkedAt: now, consecutiveFailures, lastHealthyAt })
    return healthy
  }

  private setHealthState(instanceId: string, state: HealthState): void {
    this.healthCache.set(instanceId, state)
  }
}
