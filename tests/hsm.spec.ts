import { describe, expect, it } from 'vitest'
import { MeshConfigNormalizer } from '../src/config/MeshConfigNormalizer.js'
import { HsmRouteMapper } from '../src/hsm/HsmRouteMapper.js'
import { RouteMatcher } from '../src/router/RouteMatcher.js'
import type { MeshHsmSchemaLike, MeshInstanceRecord } from '../src/core/types.js'

const schema: MeshHsmSchemaLike = {
  kind: 'panom-hsm.schema',
  id: 'panom',
  version: '1.0.0',
  index: {
    states: [
      { id: 'landing.home', tags: ['public'] },
      { id: 'app.profile.owner', tags: ['app'], backend: { routes: ['/api/profile/:username'], methods: ['GET', 'PATCH'] } },
      { id: 'cloud.media', tags: ['cloud'], backend: { routes: ['/api/cloud/media'] } }
    ],
    routes: [
      { stateId: 'landing.home', canonicalPattern: '/', kind: 'canonical' },
      { stateId: 'app.profile.owner', canonicalPattern: '/profile/:username', kind: 'canonical' },
      { stateId: 'cloud.media', canonicalPattern: '/cloud/media', kind: 'canonical' }
    ]
  }
}

describe('HsmRouteMapper', () => {
  it('maps HSM canonical and backend routes to mesh services', () => {
    const routes = new HsmRouteMapper().map({
      schema,
      routeMode: 'both',
      strict: true,
      mappings: [
        { service: 'web', tags: ['app', 'public'], includeBackendRoutes: false },
        { service: 'api', states: ['app.*', 'cloud.*'], includeCanonicalRoutes: false }
      ],
      services: {
        web: { command: 'npm run dev' },
        api: { command: 'npm run dev' }
      }
    })

    expect(routes.map(route => `${route.service}:${route.route}:${route.source}`).sort()).toEqual([
      'api:/api/cloud/media:hsm:backend',
      'api:/api/profile/:username:hsm:backend',
      'web:/:hsm:canonical',
      'web:/profile/:username:hsm:canonical'
    ])
  })

  it('normalizes services with HSM-derived routes', () => {
    const normalized = new MeshConfigNormalizer().normalize({
      app: 'panom',
      hsm: {
        schema,
        routeMode: 'both',
        strict: true,
        mappings: [
          { service: 'frontend', tags: ['public', 'app'], includeBackendRoutes: false },
          { service: 'api', states: ['app.*'], includeCanonicalRoutes: false }
        ]
      },
      services: {
        frontend: { type: 'frontend', command: 'npm run dev', route: '/' },
        api: { type: 'backend', command: 'npm run dev', route: '/api' }
      }
    })

    expect(normalized.hsm.enabled).toBe(true)
    expect(normalized.services.get('frontend')?.routes).toContain('/profile/:username')
    expect(normalized.services.get('api')?.routes).toContain('/api/profile/:username')
  })
})

describe('RouteMatcher dynamic HSM patterns', () => {
  it('matches dynamic route ownership prefixes', () => {
    const matcher = new RouteMatcher()
    const match = matcher.match('/profile/yusuf/media', [record('web', '/'), record('api', '/api'), record('profile', '/profile/:username')])
    expect(match?.service).toBe('profile')
  })
})

function record(service: string, route: string): MeshInstanceRecord {
  return {
    id: `${service}-a1`,
    service,
    serviceType: 'backend',
    status: 'running',
    pid: 1,
    port: 3000,
    host: '127.0.0.1',
    url: 'http://127.0.0.1:3000',
    command: ['node', 'server.js'],
    cwd: process.cwd(),
    logFile: `${service}.log`,
    startedAt: new Date().toISOString(),
    metadata: { routes: [route] }
  }
}
