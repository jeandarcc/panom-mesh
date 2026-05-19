import type { MeshInstanceRecord } from '../core/types.js'
import type { MeshRouteMatch } from './types.js'

interface RouteCandidate {
  readonly service: string
  readonly route: string
}

export class RouteMatcher {
  public match(pathname: string, instances: readonly MeshInstanceRecord[]): MeshRouteMatch | null {
    const routes = [...this.collectRoutes(instances)]
    routes.sort((a, b) => this.score(b.route) - this.score(a.route) || a.route.localeCompare(b.route))
    for (const route of routes) {
      if (this.matches(pathname, route.route)) {
        return { service: route.service, route: route.route, pathname }
      }
    }
    return null
  }

  public collectRoutes(instances: readonly MeshInstanceRecord[]): readonly RouteCandidate[] {
    const seen = new Set<string>()
    const routes: RouteCandidate[] = []
    for (const instance of instances) {
      const metadata = instance.metadata ?? {}
      const rawRoutes = Array.isArray(metadata.routes) ? metadata.routes : []
      for (const item of rawRoutes) {
        if (typeof item !== 'string') continue
        const route = this.normalizeRoute(item)
        const key = `${instance.service}:${route}`
        if (seen.has(key)) continue
        seen.add(key)
        routes.push({ service: instance.service, route })
      }
    }
    return routes
  }

  private matches(pathname: string, route: string): boolean {
    const path = this.normalizeRoute(pathname)
    if (route === '/') return true
    if (!route.includes(':') && !route.includes('*')) return path === route || path.startsWith(`${route}/`)
    return this.matchesPatternPrefix(path, route)
  }

  private matchesPatternPrefix(pathname: string, pattern: string): boolean {
    const pathSegments = this.segments(pathname)
    const routeSegments = this.segments(pattern)
    if (routeSegments.length > pathSegments.length) return false
    for (let index = 0; index < routeSegments.length; index += 1) {
      const route = routeSegments[index]!
      const path = pathSegments[index]!
      if (route === '*') return true
      if (route.startsWith(':')) {
        if (!path) return false
        continue
      }
      if (route !== path) return false
    }
    return true
  }

  private normalizeRoute(route: string): string {
    if (route === '/') return '/'
    return `/${route.replace(/^\/+|\/+$/g, '')}`
  }

  private segments(route: string): readonly string[] {
    return route.split('/').filter(Boolean)
  }

  private score(route: string): number {
    if (route === '/') return 0
    return this.segments(route).reduce((score, segment) => {
      if (segment === '*') return score + 1
      if (segment.startsWith(':')) return score + 5
      return score + 20 + segment.length
    }, route.length)
  }
}
