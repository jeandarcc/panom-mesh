import http from 'node:http'
import type { MeshInstanceRecord, NormalizedMeshConfig } from '../core/types.js'
import { RegistryFactory } from '../registry/RegistryFactory.js'
import { RegistryRecordTools } from '../registry/RegistryRecordTools.js'
import type { MeshRegistry } from '../registry/types.js'

export class InstanceRegistry {
  private readonly registry: MeshRegistry
  private readonly healthCache = new Map<string, { healthy: boolean; checkedAt: number }>()

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

  private async checkHttpHealth(instance: MeshInstanceRecord, healthPath: string): Promise<boolean> {
    if (!instance.url) return false
    const cache = this.healthCache.get(instance.id)
    const now = Date.now()
    if (cache && now - cache.checkedAt < 1_000) return cache.healthy

    const target = new URL(healthPath, instance.url)
    const healthy = await new Promise<boolean>(resolve => {
      const req = http.request(target, { method: 'GET', timeout: 1_000 }, res => {
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
    this.healthCache.set(instance.id, { healthy, checkedAt: now })
    return healthy
  }
}
