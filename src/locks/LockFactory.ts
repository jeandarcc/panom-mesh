import type { NormalizedMeshConfig } from '../core/types.js'
import { MemoryLockBackend } from './MemoryLockBackend.js'
import { LockManager } from './LockManager.js'
import { RedisLockBackend } from './redis/RedisLockBackend.js'
import type { MeshLockBackend } from './types.js'

export class LockFactory {
  public createBackend(config: NormalizedMeshConfig): MeshLockBackend {
    if (config.coordination.locks.backend === 'redis') {
      return new RedisLockBackend({
        app: config.app,
        url: config.coordination.locks.url,
        keyPrefix: config.coordination.keyPrefix,
        connectTimeoutMs: config.coordination.connectTimeoutMs
      })
    }
    return new MemoryLockBackend()
  }

  public createManager(config: NormalizedMeshConfig, ownerId?: string): LockManager {
    return new LockManager(this.createBackend(config), ownerId)
  }
}
