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
    // Keep the Node event loop alive while mesh supervises detached Podman containers.
    // waitForever() alone does not hold the process open; unref() here caused systemd
    // ExecStart to exit ~3s after container start (Restart=always stop/start loop).
  }

  public stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }
}
