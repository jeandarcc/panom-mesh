import type { NormalizedMeshStreamingConfig } from '../core/types.js'

export class MeshStreamChannels {
  public constructor(private readonly config: NormalizedMeshStreamingConfig) {}

  public logs(): string {
    return `${this.config.keyPrefix}:stream:logs`
  }

  public events(): string {
    return `${this.config.keyPrefix}:stream:events`
  }

  public all(): readonly string[] {
    return [this.logs(), this.events()]
  }
}
