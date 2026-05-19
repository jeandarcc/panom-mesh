import { defineMeshConfig } from '../../src/index.js'
import hsmSchema from './hsm.schema.json'

export default defineMeshConfig({
  app: 'panom',

  router: {
    port: 8080,
    secret: process.env.MESH_SECRET ?? 'dev-secret'
  },

  hsm: {
    schema: hsmSchema,
    routeMode: 'both',
    strict: true,
    mappings: [
      {
        service: 'frontend',
        tags: ['public', 'app', 'cloud'],
        includeBackendRoutes: false
      },
      {
        service: 'api',
        states: ['app.*', 'cloud.*'],
        includeCanonicalRoutes: false
      }
    ]
  },

  services: {
    frontend: {
      type: 'frontend',
      command: 'npm run dev',
      cwd: './frontend',
      port: 5173,
      route: '/'
    },

    api: {
      type: 'backend',
      command: 'npm run dev',
      cwd: './backend',
      instances: 3,
      healthPath: '/health',
      strategy: 'session-affinity'
    }
  }
})
