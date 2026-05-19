import type { NormalizedMeshConfig } from '../core/types.js'
import { MemoryMeshStream } from './MemoryMeshStream.js'
import { RedisMeshStream } from './redis/RedisMeshStream.js'
import type { MeshStreamPublisher, MeshStreamSubscriber } from './types.js'

export class MeshStreamFactory {
  public createPublisher(config: NormalizedMeshConfig): MeshStreamPublisher | null {
    if (!config.streaming.enabled) return null
    if (config.streaming.transport === 'redis') return new RedisMeshStream(config)
    return new MemoryMeshStream(config)
  }

  public createSubscriber(config: NormalizedMeshConfig): MeshStreamSubscriber | null {
    if (!config.streaming.enabled) return null
    if (config.streaming.transport === 'redis') return new RedisMeshStream(config)
    return new MemoryMeshStream(config)
  }
}
