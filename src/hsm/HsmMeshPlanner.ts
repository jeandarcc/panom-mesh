import type { NormalizedMeshConfig, MeshHsmPlanOptions } from '../core/types.js'
import { HsmRouteMapper } from './HsmRouteMapper.js'

export class HsmMeshPlanner {
  public constructor(private readonly config: NormalizedMeshConfig) {}

  public plan(options: MeshHsmPlanOptions = {}): string {
    const routes = this.config.hsm.routes
    if (options.json) return `${JSON.stringify(routes, null, 2)}\n`
    return new HsmRouteMapper().summarize(routes)
  }
}
