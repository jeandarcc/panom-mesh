import type { MeshPodmanGenerateOptions, MeshPodmanPlanOptions, NormalizedMeshConfig } from '../core/types.js'
import { ensureDir } from '../utils/fs.js'
import { PodmanCommandBuilder } from './PodmanCommandBuilder.js'
import { PodmanPlan } from './PodmanPlan.js'
import { PodmanQuadletGenerator } from './quadlet/PodmanQuadletGenerator.js'

export class PodmanCommands {
  public constructor(private readonly config: NormalizedMeshConfig) {}

  public async plan(options: MeshPodmanPlanOptions = {}): Promise<string> {
    const specs = await new PodmanPlan(this.config).build()
    const builder = new PodmanCommandBuilder(this.config)
    const rows = specs.map(spec => ({
      id: spec.id,
      service: spec.service.name,
      name: spec.name,
      image: spec.image,
      port: spec.hostPort === null ? '-' : `${spec.hostPort}:${spec.containerPort}`,
      command: `${this.config.runtime.podman.podmanPath} ${builder.runServiceArgs(spec).join(' ')}`
    }))
    if (options.json) return `${JSON.stringify(rows, null, 2)}\n`
    return rows.map(row => `${row.service}\t${row.name}\t${row.image}\t${row.port}\n  ${row.command}`).join('\n') + '\n'
  }

  public async generate(options: MeshPodmanGenerateOptions = {}): Promise<string> {
    const outDir = options.outputDir ?? this.config.runtime.podman.quadlet.outputDir
    const files = await new PodmanQuadletGenerator(this.config).generate()
    await ensureDir(outDir)
    const fs = await import('node:fs')
    for (const file of files) {
      const target = `${outDir}/${file.name}`
      if (!options.force && fs.existsSync(target)) throw new Error(`Quadlet file already exists: ${target}. Use --force to overwrite.`)
      await fs.promises.writeFile(target, file.content, 'utf8')
    }
    const lines = [`Generated ${files.length} Quadlet file(s) in ${outDir}.`]
    if (options.print) lines.push('', ...files.flatMap(file => [`# ${file.name}`, file.content.trim(), '']))
    if (this.config.runtime.podman.quadlet.installCommand) {
      lines.push('Reload systemd after copying/installing:', this.config.runtime.podman.quadlet.user ? '  systemctl --user daemon-reload' : '  sudo systemctl daemon-reload')
    }
    return `${lines.join('\n')}\n`
  }
}
