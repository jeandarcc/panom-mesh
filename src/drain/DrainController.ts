import type { MeshRegistry } from '../registry/types.js'
import type { MeshInstanceRecord } from '../core/types.js'
import { ProcessHealth } from '../state/ProcessHealth.js'
import { sleep } from '../utils/time.js'

export interface DrainTargetResult {
  readonly instance: MeshInstanceRecord
  readonly signalled: boolean
  readonly killed: boolean
  readonly unregistered: boolean
}

export interface DrainControllerOptions {
  readonly registry: MeshRegistry
  readonly drainTimeoutMs: number
  readonly shutdownTimeoutMs: number
  readonly killTimeoutMs: number
  readonly force?: boolean
}

export class DrainController {
  private readonly health = new ProcessHealth()

  public constructor(private readonly options: DrainControllerOptions) {}

  public async drainAndStop(instances: readonly MeshInstanceRecord[]): Promise<readonly DrainTargetResult[]> {
    for (const instance of instances) {
      if (!this.options.force) await this.options.registry.markDraining(instance.id).catch(() => undefined)
    }

    if (!this.options.force && this.options.drainTimeoutMs > 0) {
      await sleep(this.options.drainTimeoutMs)
    }

    const results: DrainTargetResult[] = []
    await Promise.all(instances.map(async instance => {
      const signalled = this.signal(instance, 'SIGTERM')
      if (signalled) await this.waitUntilDead(instance.pid, this.options.shutdownTimeoutMs)
      const killed = this.health.isAlive(instance.pid) ? this.signal(instance, 'SIGKILL') : false
      if (killed) await this.waitUntilDead(instance.pid, this.options.killTimeoutMs)
      await this.options.registry.unregister(instance.id).catch(() => undefined)
      results.push({ instance, signalled, killed, unregistered: true })
    }))

    return results.sort((a, b) => a.instance.id.localeCompare(b.instance.id))
  }

  private signal(instance: MeshInstanceRecord, signal: NodeJS.Signals): boolean {
    if (!this.health.isAlive(instance.pid)) return false
    try {
      process.kill(instance.pid!, signal)
      return true
    } catch {
      return false
    }
  }

  private async waitUntilDead(pid: number | null, timeoutMs: number): Promise<void> {
    const started = Date.now()
    while (this.health.isAlive(pid) && Date.now() - started < timeoutMs) {
      await sleep(100)
    }
  }
}
