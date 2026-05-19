import { describe, expect, it } from 'vitest'
import { MeshConfigNormalizer } from '../src/config/MeshConfigNormalizer.js'
import { defineMeshConfig } from '../src/config/defineMeshConfig.js'

const normalizer = new MeshConfigNormalizer()

describe('MeshConfigNormalizer', () => {
  it('normalizes defaults and commands', () => {
    const config = defineMeshConfig({
      app: 'panom',
      services: {
        api: {
          command: 'npm run dev',
          route: '/api',
          instances: 3
        }
      }
    })

    const normalized = normalizer.normalize(config, process.cwd())
    const api = normalized.services.get('api')!

    expect(normalized.router.port).toBe(8080)
    expect(normalized.runtime.mode).toBe('process')
    expect(api.name).toBe('api')
    expect(api.command).toEqual(['npm run dev'])
    expect(api.shell).toBe(true)
    expect(api.routes).toEqual(['/api'])
    expect(api.instances).toBe(3)
  })

  it('rejects route values without leading slash', () => {
    expect(() => normalizer.normalize({
      app: 'bad',
      services: {
        api: {
          command: 'npm run dev',
          route: 'api'
        }
      }
    })).toThrow(/must start with/)
  })
})

describe('MeshConfigNormalizer observability', () => {
  it('normalizes dashboard management path', () => {
    const normalized = normalizer.normalize(defineMeshConfig({
      app: 'panom',
      observability: { path: 'mesh-admin', refreshIntervalMs: 2500 },
      services: { api: { command: 'node api.js' } }
    }), process.cwd())
    expect(normalized.observability.path).toBe('/mesh-admin')
    expect(normalized.observability.refreshIntervalMs).toBe(2500)
  })
})
