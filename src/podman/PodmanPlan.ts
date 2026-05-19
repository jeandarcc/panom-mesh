import type { NormalizedMeshConfig, NormalizedMeshServiceConfig } from '../core/types.js'
import { MeshIdFactory } from '../ids/MeshIdFactory.js'
import { PortAllocator } from '../process/PortAllocator.js'
import { LogStore } from '../logs/LogStore.js'
import type { PodmanContainerSpec } from './PodmanCommandBuilder.js'

export class PodmanPlan {
  private readonly ids = new MeshIdFactory()
  private readonly ports = new PortAllocator()
  private readonly logs: LogStore

  public constructor(private readonly config: NormalizedMeshConfig) {
    this.logs = new LogStore(config.runtime.logsDir)
  }

  public async build(services = Array.from(this.config.services.values()), instancesOverride?: number): Promise<readonly PodmanContainerSpec[]> {
    const specs: PodmanContainerSpec[] = []
    for (const service of services) {
      const image = this.imageFor(service)
      const count = instancesOverride ?? service.instances
      for (let index = 0; index < count; index += 1) {
        const id = this.ids.createInstanceId(service.name)
        const containerPort = service.type === 'worker' ? null : service.podman.containerPort
        const hostPort = containerPort === null
          ? null
          : await this.ports.reservePreferred(index === 0 ? service.port : undefined, service.portRange)
        specs.push({
          id,
          name: this.containerName(service.name, index, id),
          image,
          service,
          index,
          hostPort,
          containerPort,
          logFile: this.logs.getLogPath(id)
        })
      }
    }
    return specs
  }

  public containerName(serviceName: string, index: number, id: string): string {
    const suffix = id.split('-').pop() ?? String(index + 1)
    return `${this.config.runtime.podman.containerPrefix}-${serviceName}-${index + 1}-${suffix}`
  }

  private imageFor(service: NormalizedMeshServiceConfig): string {
    const image = service.podman.image ?? service.image
    if (!image) {
      throw new Error(`Service "${service.name}" needs image or podman.image when runtime.mode is "podman".`)
    }
    return image
  }
}
