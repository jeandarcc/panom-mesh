import path from 'node:path'
import { spawnSync } from 'node:child_process'
import type { NormalizedMeshConfig } from '../core/types.js'
import { MeshConfigError } from '../core/errors.js'
import { ensureDir, pathExists } from '../utils/fs.js'

export interface MeshCertInitOptions {
  readonly force?: boolean
}

export class CertInitCommand {
  public async run(config: NormalizedMeshConfig, options: MeshCertInitOptions = {}): Promise<string> {
    if (!config.router.tls.enabled || !config.router.tls.certPath || !config.router.tls.keyPath) {
      throw new MeshConfigError('mesh cert:init requires router.tls.enabled with router.tls.certPath and router.tls.keyPath configured.')
    }

    this.assertMkcertAvailable()

    const certPath = config.router.tls.certPath
    const keyPath = config.router.tls.keyPath
    const host = config.router.host

    if (!options.force && await pathExists(certPath) && await pathExists(keyPath)) {
      return this.summary(config, certPath, keyPath, false)
    }

    await ensureDir(path.dirname(certPath))
    await ensureDir(path.dirname(keyPath))

    this.runMkcert(['-install'])
    this.runMkcert(['-cert-file', certPath, '-key-file', keyPath, host])

    return this.summary(config, certPath, keyPath, true)
  }

  private assertMkcertAvailable(): void {
    const result = spawnSync('mkcert', ['-help'], { encoding: 'utf8' })
    if (result.error || result.status !== 0) {
      throw new MeshConfigError('mkcert is required for mesh cert:init. Install mkcert first, then rerun the command.')
    }
  }

  private runMkcert(args: readonly string[]): void {
    const result = spawnSync('mkcert', [...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    if (result.error || result.status !== 0) {
      const detail = result.stderr?.trim() || result.stdout?.trim() || result.error?.message || 'mkcert failed'
      throw new MeshConfigError(detail)
    }
  }

  private summary(config: NormalizedMeshConfig, certPath: string, keyPath: string, created: boolean): string {
    const status = created ? 'created' : 'already present'
    return `mesh cert:init: ${status}
host: ${config.router.host}
cert: ${certPath}
key: ${keyPath}
origins:
${config.router.publicOrigins.map(origin => `- ${origin}`).join('\n')}
`
  }
}
