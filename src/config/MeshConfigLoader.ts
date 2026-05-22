import fs from 'node:fs'
import path from 'node:path'
import { createJiti } from 'jiti'
import { MeshConfigError } from '../core/errors.js'
import type { MeshConfig, NormalizedMeshConfig } from '../core/types.js'
import { pathExists } from '../utils/fs.js'
import { MeshConfigNormalizer } from './MeshConfigNormalizer.js'
import { HsmSchemaLoader } from '../hsm/HsmSchemaLoader.js'
import { applyMeshenv } from './meshEnv.js'

const CONFIG_FILES = [
  'mesh.config.ts',
  'mesh.config.mts',
  'mesh.config.cts',
  'mesh.config.js',
  'mesh.config.mjs',
  'mesh.config.cjs',
  'mesh.config.json'
] as const

export class MeshConfigLoader {
  private readonly normalizer = new MeshConfigNormalizer()
  private readonly hsmLoader = new HsmSchemaLoader()

  public async findConfig(projectRoot = process.cwd()): Promise<string> {
    for (const file of CONFIG_FILES) {
      const candidate = path.resolve(projectRoot, file)
      if (await pathExists(candidate)) return candidate
    }
    throw new MeshConfigError(`No mesh config found in ${projectRoot}. Run: npx @panomapp/mesh init`)
  }

  public async load(configPath?: string, projectRoot = process.cwd()): Promise<NormalizedMeshConfig> {
    applyMeshenv(projectRoot)
    const resolvedPath = configPath ? path.resolve(projectRoot, configPath) : await this.findConfig(projectRoot)
    const raw = await this.loadRaw(resolvedPath)
    const hydrated = await this.hsmLoader.hydrateConfig(raw, resolvedPath)
    return this.normalizer.normalize(hydrated, path.dirname(resolvedPath), resolvedPath)
  }

  private async loadRaw(configPath: string): Promise<MeshConfig> {
    if (!fs.existsSync(configPath)) throw new MeshConfigError(`Mesh config not found: ${configPath}`)

    if (configPath.endsWith('.json')) {
      const text = await fs.promises.readFile(configPath, 'utf8')
      return JSON.parse(text) as MeshConfig
    }

    const jiti = createJiti(configPath, { interopDefault: true })
    const mod = await jiti.import(configPath)
    const loaded = (mod as { default?: unknown }).default ?? mod
    if (!loaded || typeof loaded !== 'object') {
      throw new MeshConfigError(`Mesh config must export an object: ${configPath}`)
    }
    return loaded as MeshConfig
  }
}
