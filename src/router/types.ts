import type { MeshInstanceRecord, MeshServiceStrategy, NormalizedMeshConfig } from '../core/types.js'

export interface MeshRouteMatch {
  readonly service: string
  readonly route: string
  readonly pathname: string
}

export interface MeshTargetNode {
  readonly instance: MeshInstanceRecord
  readonly url: URL
  readonly strategy: MeshServiceStrategy
}

export interface MeshRouterRequestContext {
  readonly config: NormalizedMeshConfig
  readonly requestId: string
  readonly pathname: string
  readonly method: string
  readonly headers: Record<string, string | readonly string[] | undefined>
}

export interface MeshProxyResult {
  readonly ok: boolean
  readonly statusCode: number
  readonly service?: string
  readonly targetId?: string
  readonly targetUrl?: string
  readonly error?: string
}
