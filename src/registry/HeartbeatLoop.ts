import type { MeshRegistry } from './types.js'

export class HeartbeatLoop {
  private timer: NodeJS.Timeout | null = null

  public constructor(
    private readonly registry: MeshRegistry,
    private readonly instanceId: string,
    private readonly intervalMs: number,
    private readonly ttlMs: number
  ) {}

  public start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.registry.heartbeat(this.instanceId, { ttlMs: this.ttlMs }).catch(() => undefined)
    }, this.intervalMs)
    this.timer.unref?.()
  }

  public stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }
}
