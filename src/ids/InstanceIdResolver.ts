import { MeshIdResolutionError } from '../core/errors.js'
import type { MeshInstanceRecord } from '../core/types.js'

export class InstanceIdResolver {
  public resolve(instances: readonly MeshInstanceRecord[], prefix: string): MeshInstanceRecord {
    const normalized = prefix.trim()
    if (!normalized) throw new MeshIdResolutionError('Instance id prefix is required.')

    const matches = instances.filter(instance => instance.id.startsWith(normalized) || instance.id.includes(normalized))
    if (matches.length === 0) throw new MeshIdResolutionError(`No instance matches "${prefix}".`)
    if (matches.length > 1) {
      throw new MeshIdResolutionError(`Ambiguous instance id "${prefix}": ${matches.map(match => match.id).join(', ')}`)
    }
    return matches[0]!
  }
}
