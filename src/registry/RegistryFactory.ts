import { FileMeshRegistry } from './FileMeshRegistry.js'
import type { MeshRegistry } from './types.js'
import type { NormalizedMeshConfig } from '../core/types.js'
import { RedisMeshRegistry } from './redis/RedisMeshRegistry.js'

export class RegistryFactory {
  public create(config: NormalizedMeshConfig): MeshRegistry {
    if (config.registry.type === 'file') {
      return new FileMeshRegistry(config.app, config.runtime.stateDir)
    }
    return new RedisMeshRegistry({
      app: config.app,
      url: config.registry.url,
      ...(config.registry.keyPrefix !== undefined ? { keyPrefix: config.registry.keyPrefix } : {}),
      ...(config.registry.secret !== undefined ? { secret: config.registry.secret } : {}),
      requireSignature: config.registry.requireSignature,
      connectTimeoutMs: config.registry.connectTimeoutMs
    })
  }
}
