import { defineMeshConfig } from '@panomapp/mesh'

export default defineMeshConfig({
  app: 'panom-like',
  router: {
    port: 8080,
    host: '127.0.0.1',
    sessionAffinity: true,
    secret: process.env.MESH_SECRET ?? 'dev-only-change-me'
  },
  registry: {
    type: process.env.REDIS_URL ? 'redis' : 'file',
    ...(process.env.REDIS_URL ? { url: process.env.REDIS_URL } : {}),
    ...(process.env.MESH_SECRET ? { secret: process.env.MESH_SECRET } : {}),
    requireSignature: Boolean(process.env.REDIS_URL),
    ttlMs: 15_000,
    heartbeatIntervalMs: 5_000
  },
  streaming: {
    enabled: Boolean(process.env.REDIS_URL),
    transport: process.env.REDIS_URL ? 'redis' : 'memory',
    ...(process.env.REDIS_URL ? { url: process.env.REDIS_URL } : {})
  },
  coordination: {
    enabled: true,
    backend: process.env.REDIS_URL ? 'redis' : 'memory',
    ...(process.env.REDIS_URL ? { url: process.env.REDIS_URL } : {}),
    cleanup: { enabled: true }
  },
  services: {
    frontend: {
      type: 'frontend',
      command: 'npm run dev',
      cwd: './frontend',
      instances: 1,
      route: '/',
      port: 5173
    },
    api: {
      type: 'backend',
      command: 'npm run dev',
      cwd: './backend',
      instances: 3,
      route: ['/api', '/ws'],
      healthPath: '/health',
      strategy: 'session-affinity'
    },
    worker: {
      type: 'worker',
      command: 'npm run worker',
      cwd: './backend',
      instances: 1,
      watch: false
    }
  }
})
