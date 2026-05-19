import { MeshConfigError } from '../core/errors.js'
import type { MeshHsmSchemaLike } from '../core/types.js'

export class HsmSchemaValidator {
  public assertValid(schema: unknown): asserts schema is MeshHsmSchemaLike {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      throw new MeshConfigError('hsm.schema must be an object compatible with a compiled @panomapp/hsm schema.')
    }
    const candidate = schema as MeshHsmSchemaLike
    if (candidate.kind !== undefined && candidate.kind !== 'panom-hsm.schema') {
      throw new MeshConfigError(`Unsupported hsm.schema kind: ${String(candidate.kind)}.`)
    }
    if (!candidate.index || typeof candidate.index !== 'object') {
      throw new MeshConfigError('hsm.schema.index is required.')
    }
    if (!Array.isArray(candidate.index.states)) {
      throw new MeshConfigError('hsm.schema.index.states must be an array.')
    }
    if (candidate.index.routes !== undefined && !Array.isArray(candidate.index.routes)) {
      throw new MeshConfigError('hsm.schema.index.routes must be an array when provided.')
    }
    for (const [index, state] of candidate.index.states.entries()) {
      if (!state || typeof state !== 'object' || typeof state.id !== 'string' || state.id.length === 0) {
        throw new MeshConfigError(`hsm.schema.index.states[${index}].id must be a non-empty string.`)
      }
    }
    for (const [index, route] of (candidate.index.routes ?? []).entries()) {
      if (!route || typeof route !== 'object' || typeof route.stateId !== 'string' || route.stateId.length === 0) {
        throw new MeshConfigError(`hsm.schema.index.routes[${index}].stateId must be a non-empty string.`)
      }
      const pattern = route.canonicalPattern ?? route.pattern
      if (pattern !== undefined && (typeof pattern !== 'string' || !pattern.startsWith('/'))) {
        throw new MeshConfigError(`hsm.schema.index.routes[${index}] pattern must start with /.`)
      }
    }
  }
}
