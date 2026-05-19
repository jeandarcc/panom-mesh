import { DrainController } from '../drain/DrainController.js'
import { PodmanSupervisor } from '../podman/PodmanSupervisor.js'
import { RegistryFactory } from '../registry/RegistryFactory.js'
import type { MeshStopOptions, NormalizedMeshConfig } from '../core/types.js'

export class StopCommand {
  private readonly registry

  public constructor(private readonly config: NormalizedMeshConfig) {
    this.registry = new RegistryFactory().create(config)
  }

  public async run(serviceOrId?: string, options: MeshStopOptions = {}): Promise<string> {
    if (this.config.runtime.mode === 'podman') {
      const podmanOptions: { force?: boolean; shutdownTimeoutMs?: number } = { force: options.force ?? false }
      if (options.shutdownTimeoutMs !== undefined) podmanOptions.shutdownTimeoutMs = options.shutdownTimeoutMs
      return new PodmanSupervisor(this.config).stop(serviceOrId, podmanOptions)
    }

    const instances = await this.registry.list({ includeExpired: true })
    const targets = serviceOrId
      ? instances.filter(instance => instance.service === serviceOrId || instance.id.startsWith(serviceOrId))
      : instances

    const controller = new DrainController({
      registry: this.registry,
      drainTimeoutMs: options.drainTimeoutMs ?? this.config.runtime.drainTimeoutMs,
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? this.config.runtime.shutdownTimeoutMs,
      killTimeoutMs: options.killTimeoutMs ?? this.config.runtime.killTimeoutMs,
      force: options.force ?? false
    })
    const results = await controller.drainAndStop(targets)
    const killed = results.filter(result => result.killed).length
    const signalled = results.filter(result => result.signalled).length
    return `Stopped ${targets.length} instance(s). signalled=${signalled} killed=${killed}\n`
  }
}
