import { defineMeshConfig } from '../../src/index.js'

export default defineMeshConfig({
  app: 'streaming-demo',

  registry: {
    type: 'redis',
    url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    secret: process.env.MESH_SECRET ?? 'dev-secret'
  },

  streaming: {
    enabled: true,
    transport: 'redis',
    url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    logs: true,
    events: true,
    maxLogChunkBytes: 32768
  },

  router: {
    port: 8080,
    secret: process.env.MESH_SECRET ?? 'dev-secret'
  },

  services: {
    api: {
      command: 'npm run dev',
      route: '/api',
      instances: 3,
      strategy: 'session-affinity',
      healthPath: '/health'
    }
  }
})
