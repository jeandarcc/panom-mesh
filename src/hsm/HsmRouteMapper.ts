import { MeshConfigError } from '../core/errors.js'
import type {
  MeshHsmMappedRoute,
  MeshHsmRouteMode,
  MeshHsmSchemaLike,
  MeshHsmSchemaStateIndexEntry,
  MeshHsmServiceBinding,
  MeshHsmServiceMapping,
  MeshServiceConfig
} from '../core/types.js'
import { HsmSchemaValidator } from './HsmSchemaValidator.js'

export interface HsmRouteMapperOptions {
  readonly schema: MeshHsmSchemaLike
  readonly routeMode: MeshHsmRouteMode
  readonly strict: boolean
  readonly mappings: readonly MeshHsmServiceMapping[]
  readonly services: Record<string, MeshServiceConfig>
}

export class HsmRouteMapper {
  private readonly validator: HsmSchemaValidator = new HsmSchemaValidator()

  public map(options: HsmRouteMapperOptions): readonly MeshHsmMappedRoute[] {
    this.validator.assertValid(options.schema)
    const routes: MeshHsmMappedRoute[] = []
    const stateById = new Map<string, MeshHsmSchemaStateIndexEntry>()
    for (const state of options.schema.index?.states ?? []) stateById.set(state.id, state)

    const mappings = this.collectMappings(options.services, options.mappings)
    for (const mapping of mappings) {
      if (!options.services[mapping.service]) {
        if (options.strict) throw new MeshConfigError(`HSM mapping references unknown mesh service: ${mapping.service}`)
        continue
      }
      const selectedStates = this.selectStates(stateById, mapping)
      if (selectedStates.length === 0 && options.strict) {
        throw new MeshConfigError(`HSM mapping for service "${mapping.service}" matched no states.`)
      }
      const selectedIds = new Set(selectedStates.map(state => state.id))
      if (this.includeCanonical(mapping, options.routeMode)) {
        for (const route of options.schema.index?.routes ?? []) {
          if (!selectedIds.has(route.stateId)) continue
          if (route.kind === 'virtual') continue
          if (route.isAlias && route.redirectToCanonical) continue
          const pattern = route.canonicalPattern ?? route.pattern
          if (!pattern) continue
          routes.push(this.toMappedRoute(mapping, 'hsm:canonical', route.stateId, pattern))
        }
      }
      if (this.includeBackend(mapping, options.routeMode)) {
        for (const state of selectedStates) {
          for (const route of state.backend?.routes ?? []) {
            routes.push(this.toMappedRoute(mapping, 'hsm:backend', state.id, route, state.backend?.methods))
          }
        }
      }
    }

    return this.dedupe(routes)
  }

  public summarize(routes: readonly MeshHsmMappedRoute[]): string {
    if (routes.length === 0) return 'No HSM routes mapped.\n'
    const rows = routes.map(route => ({
      service: route.service,
      route: route.route,
      source: route.source,
      state: route.stateId,
      methods: route.methods?.join(',') ?? '-'
    }))
    const headers = ['SERVICE', 'ROUTE', 'SOURCE', 'STATE', 'METHODS']
    const keys = ['service', 'route', 'source', 'state', 'methods'] as const
    const widths = keys.map((key, index) => Math.max(headers[index]!.length, ...rows.map(row => row[key].length)))
    const fmt = (values: readonly string[]) => values.map((value, index) => value.padEnd(widths[index]!)).join('  ')
    return `${fmt(headers)}\n${fmt(widths.map(w => '-'.repeat(w)))}\n${rows.map(row => fmt(keys.map(key => row[key]))).join('\n')}\n`
  }

  private collectMappings(services: Record<string, MeshServiceConfig>, topLevel: readonly MeshHsmServiceMapping[]): readonly MeshHsmServiceMapping[] {
    const mappings: MeshHsmServiceMapping[] = [...topLevel]
    for (const [service, config] of Object.entries(services)) {
      if (!config.hsm) continue
      mappings.push({ service, ...config.hsm })
    }
    return mappings
  }

  private selectStates(stateById: Map<string, MeshHsmSchemaStateIndexEntry>, mapping: MeshHsmServiceMapping): readonly MeshHsmSchemaStateIndexEntry[] {
    const states = Array.from(stateById.values())
    const selectors = mapping.states ?? []
    const tags = new Set(mapping.tags ?? [])
    if (selectors.length === 0 && tags.size === 0) return []
    return states.filter(state => {
      const byState = selectors.some(selector => this.matchesStateSelector(state.id, selector))
      const byTag = (state.tags ?? []).some(tag => tags.has(tag))
      return byState || byTag
    })
  }

  private matchesStateSelector(stateId: string, selector: string): boolean {
    if (selector === stateId) return true
    if (selector.endsWith('.*')) return stateId.startsWith(selector.slice(0, -2) + '.')
    return false
  }

  private includeCanonical(mapping: MeshHsmServiceBinding, mode: MeshHsmRouteMode): boolean {
    if (mapping.includeCanonicalRoutes !== undefined) return mapping.includeCanonicalRoutes
    return mode === 'canonical' || mode === 'both'
  }

  private includeBackend(mapping: MeshHsmServiceBinding, mode: MeshHsmRouteMode): boolean {
    if (mapping.includeBackendRoutes !== undefined) return mapping.includeBackendRoutes
    return mode === 'backend' || mode === 'both'
  }

  private toMappedRoute(
    mapping: MeshHsmServiceMapping,
    source: MeshHsmMappedRoute['source'],
    stateId: string,
    pattern: string,
    methods?: readonly string[]
  ): MeshHsmMappedRoute {
    const transformed = this.applyRouteTransforms(pattern, mapping)
    const effectiveMethods = mapping.methods ?? methods
    const mapped: MeshHsmMappedRoute = {
      service: mapping.service,
      route: this.toRoutablePattern(transformed),
      source,
      stateId,
      originalPattern: pattern
    }
    return effectiveMethods === undefined ? mapped : { ...mapped, methods: effectiveMethods }
  }

  private applyRouteTransforms(route: string, mapping: MeshHsmServiceMapping): string {
    let output = this.normalizePattern(route)
    if (mapping.stripPrefix) {
      const prefix = this.normalizePattern(mapping.stripPrefix)
      if (output === prefix) output = '/'
      else if (output.startsWith(`${prefix}/`)) output = output.slice(prefix.length) || '/'
    }
    if (mapping.routePrefix) {
      const prefix = this.normalizePattern(mapping.routePrefix)
      if (prefix !== '/') output = output === '/' ? prefix : `${prefix}${output}`
    }
    return this.normalizePattern(output)
  }

  private toRoutablePattern(pattern: string): string {
    const normalized = this.normalizePattern(pattern)
    if (normalized === '/') return '/'
    return normalized
  }

  private normalizePattern(route: string): string {
    const trimmed = route.trim()
    if (!trimmed || !trimmed.startsWith('/')) throw new MeshConfigError(`HSM route pattern must start with /: ${route}`)
    if (trimmed === '/') return '/'
    return `/${trimmed.replace(/^\/+|\/+$/g, '')}`
  }

  private dedupe(routes: readonly MeshHsmMappedRoute[]): readonly MeshHsmMappedRoute[] {
    const seen = new Set<string>()
    const output: MeshHsmMappedRoute[] = []
    for (const route of routes) {
      const key = `${route.service}:${route.route}:${route.source}:${route.stateId}:${route.methods?.join(',') ?? '*'}`
      if (seen.has(key)) continue
      seen.add(key)
      output.push(route)
    }
    output.sort((a, b) => a.service.localeCompare(b.service) || b.route.length - a.route.length || a.route.localeCompare(b.route))
    return output
  }
}
