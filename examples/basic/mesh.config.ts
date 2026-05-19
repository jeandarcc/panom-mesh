import { defineMeshConfig } from '../../src/index.js'

export default defineMeshConfig({
  app: 'basic-example',
  runtime: {
    mode: 'process',
    portRange: { from: 3300, to: 3399 }
  },
  services: {
    api: {
      type: 'backend',
      command: 'node server.js',
      instances: 2,
      route: '/api'
    }
  }
})
