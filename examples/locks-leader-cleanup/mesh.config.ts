import { defineMeshConfig } from '@panomapp/mesh'

export default defineMeshConfig({
  app: 'coordination-demo',
  router: {
    port: 8080,
    secret: process.env.MESH_SECRET ?? 'dev-only-change-me'
  },
  registry: {
    type: process.env.REDIS_URL ? 'redis' : 'file',
    ...(process.env.REDIS_URL ? { url: process.env.REDIS_URL } : {}),
    ...(process.env.MESH_SECRET ? { secret: process.env.MESH_SECRET } : {}),
    requireSignature: Boolean(process.env.REDIS_URL)
  },
  coordination: {
    enabled: true,
    backend: process.env.REDIS_URL ? 'redis' : 'memory',
    ...(process.env.REDIS_URL ? { url: process.env.REDIS_URL } : {}),
    locks: { ttlMs: 30_000, waitMs: 2_000 },
    leader: { ttlMs: 30_000, renewEveryMs: 10_000 },
    cleanup: { enabled: true }
  },
  services: {
    api: {
      type: 'backend',
      command: 'node examples/server.js',
      instances: 3,
      route: '/api',
      healthPath: '/health',
      strategy: 'session-affinity'
    },
    worker: {
      type: 'worker',
      command: 'node examples/cleanup-worker.js',
      instances: 1,
      watch: true
    }
  }
})
