import path from 'node:path'
import type { NormalizedMeshConfig } from '../../core/types.js'
import { PodmanPlan } from '../PodmanPlan.js'

export interface QuadletFile {
  readonly name: string
  readonly content: string
}

export class PodmanQuadletGenerator {
  public constructor(private readonly config: NormalizedMeshConfig) {}

  public async generate(): Promise<readonly QuadletFile[]> {
    const files: QuadletFile[] = []
    if (this.config.runtime.podman.createNetwork) files.push(this.networkFile())
    if (this.config.runtime.podman.redis.enabled) files.push(this.redisFile())
    const specs = await new PodmanPlan(this.config).build()
    for (const spec of specs) files.push(this.serviceFile(spec))
    if (this.config.router.enabled && specs.some(spec => spec.service.routes.length > 0)) files.push(this.routerFile())
    return files
  }

  private networkFile(): QuadletFile {
    const network = this.config.runtime.podman.network
    return {
      name: `${network}.network`,
      content: `[Network]\nNetworkName=${network}\n`
    }
  }

  private redisFile(): QuadletFile {
    const podman = this.config.runtime.podman
    return {
      name: `${podman.redis.containerName}.container`,
      content: [
        '[Unit]',
        `Description=${this.config.app} mesh Redis registry`,
        '',
        '[Container]',
        `ContainerName=${podman.redis.containerName}`,
        `Image=${podman.redis.image}`,
        `Network=${podman.network}`,
        `Volume=${podman.redis.volume}:/data`,
        `Label=panom.mesh.app=${this.config.app}`,
        'Label=panom.mesh.service=redis',
        '',
        '[Service]',
        'Restart=always',
        '',
        '[Install]',
        'WantedBy=default.target',
        ''
      ].join('\n')
    }
  }

  private serviceFile(spec: Awaited<ReturnType<PodmanPlan['build']>>[number]): QuadletFile {
    const service = spec.service
    const podman = this.config.runtime.podman
    const lines: string[] = [
      '[Unit]',
      `Description=${this.config.app} mesh ${service.name} ${spec.index + 1}`,
      '',
      '[Container]',
      `ContainerName=${spec.name}`,
      `Image=${spec.image}`,
      `Network=${podman.network}`,
      `Label=panom.mesh.app=${this.config.app}`,
      `Label=panom.mesh.id=${spec.id}`,
      `Label=panom.mesh.service=${service.name}`,
      `Label=panom.mesh.serviceType=${service.type}`,
      `Label=panom.mesh.routes=${JSON.stringify(service.routes)}`,
      `Label=panom.mesh.strategy=${service.strategy}`
    ]

    for (const [key, value] of Object.entries(service.podman.labels)) lines.push(`Label=${key}=${value}`)
    for (const [key, value] of Object.entries({ ...service.env, ...service.podman.env, ...this.meshEnv(spec) })) lines.push(`Environment=${key}=${this.escape(String(value))}`)
    for (const volume of service.podman.volumes) lines.push(`Volume=${volume}`)
    for (const publish of service.podman.publish) lines.push(`PublishPort=${publish}`)
    if (spec.hostPort !== null && spec.containerPort !== null) lines.push(`PublishPort=${podman.publishHost}:${spec.hostPort}:${spec.containerPort}`)
    if (service.podman.user) lines.push(`User=${service.podman.user}`)
    if (service.podman.workdir) lines.push(`WorkingDir=${service.podman.workdir}`)
    if (service.podman.entrypoint) lines.push(`Entrypoint=${service.podman.entrypoint.join(' ')}`)
    if (service.podman.command) lines.push(`Exec=${service.podman.command.join(' ')}`)
    for (const extra of service.podman.extraArgs) lines.push(`PodmanArgs=${extra}`)

    lines.push('', '[Service]', `Restart=${service.podman.restartPolicy}`, '', '[Install]', 'WantedBy=default.target', '')
    return { name: `${spec.name}.container`, content: lines.join('\n') }
  }

  private routerFile(): QuadletFile {
    const podman = this.config.runtime.podman
    const configMount = `${podman.quadlet.configSourceDir}:${podman.quadlet.configTargetDir}:ro`
    const lines = [
      '[Unit]',
      `Description=${this.config.app} mesh router`,
      '',
      '[Container]',
      `ContainerName=${podman.containerPrefix}-mesh-router`,
      `Image=${podman.routerImage}`,
      `Network=${podman.network}`,
      `PublishPort=${podman.publishHost}:${this.config.router.port}:${podman.routerContainerPort}`,
      `Volume=${configMount}`,
      `WorkingDir=${podman.quadlet.configTargetDir}`,
      `Environment=MESH_APP=${this.config.app}`,
      `Environment=MESH_REGISTRY_TYPE=${this.config.registry.type}`,
      `Environment=MESH_REGISTRY_URL=${this.config.registry.url}`,
      `Environment=PORT=${podman.routerContainerPort}`,
      `Environment=MESH_PORT=${podman.routerContainerPort}`,
      `Exec=mesh router --config ${this.routerConfigPath()}`,
      '',
      '[Service]',
      'Restart=always',
      '',
      '[Install]',
      'WantedBy=default.target',
      ''
    ]
    return { name: `${podman.containerPrefix}-mesh-router.container`, content: lines.join('\n') }
  }

  private meshEnv(spec: Awaited<ReturnType<PodmanPlan['build']>>[number]): Record<string, string> {
    return {
      MESH_APP: this.config.app,
      MESH_SERVICE: spec.service.name,
      MESH_SERVICE_TYPE: spec.service.type,
      MESH_INSTANCE_ID: spec.id,
      MESH_INSTANCE_INDEX: String(spec.index),
      MESH_REGISTRY_TYPE: this.config.registry.type,
      MESH_REGISTRY_URL: this.config.registry.url,
      MESH_ROUTER_HOST: this.config.router.host,
      MESH_ROUTER_PORT: String(this.config.router.port),
      ...(spec.containerPort === null ? {} : { PORT: String(spec.containerPort), MESH_PORT: String(spec.containerPort) })
    }
  }

  private routerConfigPath(): string {
    const sourceDir = this.config.runtime.podman.quadlet.configSourceDir
    const targetDir = this.config.runtime.podman.quadlet.configTargetDir
    const relative = this.config.configPath.startsWith(sourceDir)
      ? path.relative(sourceDir, this.config.configPath)
      : path.basename(this.config.configPath)
    return path.posix.join(targetDir, relative.split(path.sep).join(path.posix.sep))
  }

  private escape(value: string): string {
    return value.replace(/\n/g, '\\n')
  }
}
