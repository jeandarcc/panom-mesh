import { defineMeshConfig } from '../../src/index.js'

export default defineMeshConfig({
  app: 'observability-demo',

  router: {
    port: 8080,
    secret: 'dev-secret'
  },

  observability: {
    path: '/_mesh',
    refreshIntervalMs: 1000,
    includeLogs: true,
    logLines: 30
  },

  services: {
    frontend: {
      type: 'frontend',
      command: 'npm run dev',
      route: '/',
      port: 5173
    },

    api: {
      type: 'backend',
      command: 'npm run dev',
      route: '/api',
      instances: 3,
      strategy: 'session-affinity',
      healthPath: '/health'
    }
  }
})
