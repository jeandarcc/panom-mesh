import type { IncomingHttpHeaders } from 'node:http'
import type { MeshInstanceRecord, MeshServiceStrategy } from '../core/types.js'
import { StickySession } from './StickySession.js'

export interface LoadBalancerSelection {
  readonly instance: MeshInstanceRecord
  readonly setCookie?: string
}

export class LoadBalancer {
  private readonly cursors = new Map<string, number>()
  private readonly active = new Map<string, number>()

  public constructor(private readonly sticky: StickySession) {}

  public select(
    service: string,
    strategy: MeshServiceStrategy,
    instances: readonly MeshInstanceRecord[],
    headers: IncomingHttpHeaders
  ): LoadBalancerSelection | null {
    if (instances.length === 0) return null

    if (strategy === 'session-affinity') {
      const cookie = this.sticky.read(headers, service)
      const stickyTarget = cookie ? instances.find(instance => instance.id === cookie.nodeId) : undefined
      if (stickyTarget) return { instance: stickyTarget }
      const instance = this.roundRobin(service, instances)
      return { instance, setCookie: this.sticky.createHeader(service, instance.id) }
    }

    if (strategy === 'least-connections') {
      return { instance: this.leastConnections(instances) }
    }

    return { instance: this.roundRobin(service, instances) }
  }

  public begin(instanceId: string): void {
    this.active.set(instanceId, (this.active.get(instanceId) ?? 0) + 1)
  }

  public end(instanceId: string): void {
    this.active.set(instanceId, Math.max(0, (this.active.get(instanceId) ?? 0) - 1))
  }

  private roundRobin(service: string, instances: readonly MeshInstanceRecord[]): MeshInstanceRecord {
    const cursor = this.cursors.get(service) ?? 0
    const instance = instances[cursor % instances.length]!
    this.cursors.set(service, cursor + 1)
    return instance
  }

  private leastConnections(instances: readonly MeshInstanceRecord[]): MeshInstanceRecord {
    return [...instances].sort((a, b) => (this.active.get(a.id) ?? 0) - (this.active.get(b.id) ?? 0))[0]!
  }
}
