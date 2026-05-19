import fs from 'node:fs'
import path from 'node:path'
import { createJiti } from 'jiti'
import { MeshConfigError } from '../core/errors.js'
import type { MeshConfig, MeshHsmSchemaLike } from '../core/types.js'
import { HsmSchemaValidator } from './HsmSchemaValidator.js'

export class HsmSchemaLoader {
  private readonly validator: HsmSchemaValidator = new HsmSchemaValidator()

  public async hydrateConfig(config: MeshConfig, configPath: string): Promise<MeshConfig> {
    const hsm = config.hsm
    if (!hsm?.schemaPath || hsm.schema) return config
    const schema = await this.loadSchema(path.resolve(path.dirname(configPath), hsm.schemaPath))
    return {
      ...config,
      hsm: {
        ...hsm,
        schema
      }
    }
  }

  public async loadSchema(schemaPath: string): Promise<MeshHsmSchemaLike> {
    if (!fs.existsSync(schemaPath)) throw new MeshConfigError(`HSM schema file not found: ${schemaPath}`)
    let loaded: unknown
    if (schemaPath.endsWith('.json')) {
      loaded = JSON.parse(await fs.promises.readFile(schemaPath, 'utf8'))
    } else {
      const jiti = createJiti(schemaPath, { interopDefault: true })
      const mod = await jiti.import(schemaPath)
      loaded = (mod as { default?: unknown }).default ?? mod
    }
    this.validator.assertValid(loaded)
    return loaded
  }
}
