import type { MeshInstanceRecord, NormalizedMeshConfig, NormalizedMeshServiceConfig } from '../core/types.js'
import { getMeshenv } from '../config/meshEnv.js'

export interface PodmanContainerSpec {
  readonly id: string
  readonly name: string
  readonly image: string
  readonly service: NormalizedMeshServiceConfig
  readonly index: number
  readonly hostPort: number | null
  readonly containerPort: number | null
  readonly logFile: string
}

export class PodmanCommandBuilder {
  public constructor(private readonly config: NormalizedMeshConfig) {}

  public networkExistsArgs(): readonly string[] {
    return ['network', 'exists', this.config.runtime.podman.network]
  }

  public createNetworkArgs(): readonly string[] {
    return ['network', 'create', this.config.runtime.podman.network]
  }

  public runRedisArgs(): readonly string[] {
    const podman = this.config.runtime.podman
    return [
      'run', '-d', '--replace',
      '--name', podman.redis.containerName,
      '--network', podman.network,
      '--label', `panom.mesh.app=${this.config.app}`,
      '--label', 'panom.mesh.service=redis',
      '--label', 'panom.mesh.serviceType=worker',
      '--volume', `${podman.redis.volume}:/data`,
      podman.redis.image
    ]
  }

  public runServiceArgs(spec: PodmanContainerSpec): readonly string[] {
    const podman = this.config.runtime.podman
    const service = spec.service
    const env = this.buildEnv(spec)
    const labels = this.buildLabels(spec)
    const args: string[] = ['run', '-d']
    if (podman.replace) args.push('--replace')
    args.push('--name', spec.name)
    args.push('--network', podman.network)
    args.push('--pull', podman.pull)

    for (const alias of service.podman.networkAliases) args.push('--network-alias', alias)
    for (const [key, value] of Object.entries(labels)) args.push('--label', `${key}=${value}`)
    for (const [key, value] of Object.entries(env)) args.push('--env', `${key}=${value}`)
    for (const volume of service.podman.volumes) args.push('--volume', volume)
    for (const publish of service.podman.publish) args.push('--publish', publish)
    if (spec.hostPort !== null && spec.containerPort !== null) {
      args.push('--publish', `${podman.publishHost}:${spec.hostPort}:${spec.containerPort}`)
    }
    if (service.podman.user) args.push('--user', service.podman.user)
    if (service.podman.workdir) args.push('--workdir', service.podman.workdir)
    if (service.podman.entrypoint) args.push('--entrypoint', service.podman.entrypoint.join(' '))
    args.push(...service.podman.extraArgs)
    args.push(spec.image)
    if (service.podman.command) args.push(...service.podman.command)
    return args
  }

  public stopContainerArgs(containerName: string, timeoutSeconds: number): readonly string[] {
    return ['stop', '--time', String(Math.max(0, timeoutSeconds)), containerName]
  }

  public rmContainerArgs(containerName: string): readonly string[] {
    return ['rm', '-f', containerName]
  }

  public buildRecord(spec: PodmanContainerSpec): MeshInstanceRecord {
    const host = this.config.router.host
    const url = spec.hostPort === null ? null : `http://${host}:${spec.hostPort}`
    return {
      id: spec.id,
      service: spec.service.name,
      serviceType: spec.service.type,
      status: 'running',
      pid: null,
      port: spec.hostPort,
      host,
      url,
      command: this.runServiceArgs(spec),
      cwd: spec.service.cwd,
      logFile: spec.logFile,
      startedAt: new Date().toISOString(),
      metadata: {
        runtime: 'podman',
        containerName: spec.name,
        containerPort: spec.containerPort,
        image: spec.image,
        index: spec.index,
        routes: spec.service.routes,
        hsmRoutes: spec.service.hsmRoutes,
        strategy: spec.service.strategy,
        healthPath: spec.service.healthPath,
        meshApp: this.config.app
      }
    }
  }

  private buildEnv(spec: PodmanContainerSpec): Record<string, string> {
    const service = spec.service
    return {
      ...getMeshenv(),
      ...service.env,
      ...service.podman.env,
      MESH_APP: this.config.app,
      MESH_SERVICE: service.name,
      MESH_SERVICE_TYPE: service.type,
      MESH_INSTANCE_ID: spec.id,
      MESH_INSTANCE_INDEX: String(spec.index),
      MESH_REGISTRY_TYPE: this.config.registry.type,
      MESH_REGISTRY_URL: this.config.registry.url,
      MESH_ROUTER_HOST: this.config.router.host,
      MESH_ROUTER_PORT: String(this.config.router.port),
      ...(spec.containerPort === null ? {} : { PORT: String(spec.containerPort), MESH_PORT: String(spec.containerPort) })
    }
  }

  private buildLabels(spec: PodmanContainerSpec): Record<string, string> {
    return {
      ...spec.service.podman.labels,
      'panom.mesh.app': this.config.app,
      'panom.mesh.id': spec.id,
      'panom.mesh.service': spec.service.name,
      'panom.mesh.serviceType': spec.service.type,
      'panom.mesh.routes': JSON.stringify(spec.service.routes),
      'panom.mesh.hsmRoutes': JSON.stringify(spec.service.hsmRoutes),
      'panom.mesh.strategy': spec.service.strategy,
      'panom.mesh.healthPath': spec.service.healthPath ?? '',
      'panom.mesh.hostPort': spec.hostPort === null ? '' : String(spec.hostPort),
      'panom.mesh.containerPort': spec.containerPort === null ? '' : String(spec.containerPort)
    }
  }
}
