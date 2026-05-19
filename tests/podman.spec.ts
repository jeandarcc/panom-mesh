import { describe, expect, it } from 'vitest'
import { MeshConfigNormalizer } from '../src/config/MeshConfigNormalizer.js'
import { defineMeshConfig } from '../src/config/defineMeshConfig.js'
import { PodmanPlan } from '../src/podman/PodmanPlan.js'
import { PodmanCommandBuilder } from '../src/podman/PodmanCommandBuilder.js'
import { PodmanQuadletGenerator } from '../src/podman/quadlet/PodmanQuadletGenerator.js'

function config() {
  return new MeshConfigNormalizer().normalize(defineMeshConfig({
    app: 'Panom Mesh',
    router: { port: 8080, secret: 'secret' },
    registry: { type: 'redis', url: 'redis://panom-redis:6379' },
    runtime: {
      mode: 'podman',
      podman: {
        containerPrefix: 'panom',
        network: 'panom-mesh',
        redis: { enabled: true, containerName: 'panom-redis' },
        quadlet: { outputDir: '.mesh/quadlet' }
      }
    },
    services: {
      api: {
        command: 'npm start',
        image: 'ghcr.io/panomapp/api:latest',
        route: '/api',
        port: 3000,
        instances: 2,
        podman: {
          containerPort: 3000,
          volumes: ['./data:/app/data'],
          env: { NODE_ENV: 'production' }
        }
      }
    }
  }), process.cwd(), `${process.cwd()}/mesh.config.ts`)
}

describe('PodmanPlan', () => {
  it('builds deterministic service specs with host ports and images', async () => {
    const normalized = config()
    const specs = await new PodmanPlan(normalized).build()
    expect(specs).toHaveLength(2)
    expect(specs[0]!.image).toBe('ghcr.io/panomapp/api:latest')
    expect(specs[0]!.hostPort).toBe(3000)
    expect(specs[1]!.hostPort).not.toBe(3000)
    expect(specs[0]!.name).toMatch(/^panom-api-1-/)
  })
})

describe('PodmanCommandBuilder', () => {
  it('builds secure labelled podman run commands', async () => {
    const normalized = config()
    const spec = (await new PodmanPlan(normalized).build())[0]!
    const args = new PodmanCommandBuilder(normalized).runServiceArgs(spec)
    expect(args).toContain('--replace')
    expect(args).toContain('--network')
    expect(args).toContain('panom-mesh')
    expect(args).toContain('--label')
    expect(args).toContain('panom.mesh.service=api')
    expect(args).toContain('--publish')
    expect(args).toContain('127.0.0.1:3000:3000')
    expect(args.at(-1)).toBe('ghcr.io/panomapp/api:latest')
  })
})

describe('PodmanQuadletGenerator', () => {
  it('generates network, redis, service and router Quadlet files', async () => {
    const files = await new PodmanQuadletGenerator(config()).generate()
    expect(files.map(file => file.name)).toContain('panom-mesh.network')
    expect(files.map(file => file.name)).toContain('panom-redis.container')
    expect(files.some(file => file.name.includes('api-1'))).toBe(true)
    expect(files.map(file => file.name)).toContain('panom-mesh-router.container')
    const api = files.find(file => file.name.includes('api-1'))!
    expect(api.content).toContain('Image=ghcr.io/panomapp/api:latest')
    expect(api.content).toContain('PublishPort=127.0.0.1:3000:3000')
    expect(api.content).toContain('Environment=MESH_REGISTRY_URL=redis://panom-redis:6379')
  })
})
