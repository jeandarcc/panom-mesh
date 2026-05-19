import process from 'node:process'
import type { NormalizedMeshConfig } from '../core/types.js'
import { sleep } from '../utils/time.js'
import { DashboardRenderer } from './DashboardRenderer.js'
import { ObservabilitySnapshotBuilder } from './ObservabilitySnapshotBuilder.js'
import type { MeshDashboardCommandOptions } from './types.js'

export class DashboardCommand {
  private readonly builder: ObservabilitySnapshotBuilder
  private readonly renderer = new DashboardRenderer()

  public constructor(private readonly config: NormalizedMeshConfig) {
    this.builder = new ObservabilitySnapshotBuilder(config)
  }

  public async renderOnce(options: MeshDashboardCommandOptions = {}): Promise<string> {
    const snapshot = await this.builder.build({
      includeLogs: options.includeLogs ?? this.config.observability.includeLogs,
      logLines: options.logLines ?? this.config.observability.logLines
    })
    if (options.json) return `${JSON.stringify(snapshot, null, 2)}\n`
    return this.renderer.render(snapshot, options)
  }

  public async watch(options: MeshDashboardCommandOptions = {}): Promise<void> {
    const intervalMs = options.intervalMs ?? this.config.observability.refreshIntervalMs
    let stopped = false
    const stop = (): void => { stopped = true }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)

    while (!stopped) {
      const output = await this.renderOnce(options)
      if (options.json) {
        process.stdout.write(output)
        return
      }
      process.stdout.write('\u001b[2J\u001b[H')
      process.stdout.write(output)
      await sleep(intervalMs)
    }
  }
}
