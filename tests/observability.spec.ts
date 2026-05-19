import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MeshConfigNormalizer } from '../src/config/MeshConfigNormalizer.js'
import { DashboardRenderer } from '../src/observability/DashboardRenderer.js'
import { ObservabilitySnapshotBuilder } from '../src/observability/ObservabilitySnapshotBuilder.js'
import { MeshStateStore } from '../src/state/MeshStateStore.js'
import type { MeshDashboardSnapshot } from '../src/observability/types.js'
import type { MeshInstanceRecord } from '../src/core/types.js'

describe('ObservabilitySnapshotBuilder', () => {
  it('builds service, instance and route summaries from registry state', async () => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mesh-obs-'))
    const stateDir = path.join(projectRoot, '.mesh')
    const logFile = path.join(stateDir, 'logs', 'api-a1.log')
    await fs.promises.mkdir(path.dirname(logFile), { recursive: true })
    await fs.promises.writeFile(logFile, 'started\nready')

    const config = new MeshConfigNormalizer().normalize({
      app: 'obs-test',
      router: { port: 49999 },
      runtime: { stateDir, logsDir: path.join(stateDir, 'logs') },
      observability: { includeLogs: true, logLines: 1 },
      services: {
        api: { command: 'node api.js', route: '/api', instances: 2 },
        web: { command: 'npm run dev', type: 'frontend', route: '/' }
      }
    }, projectRoot, path.join(projectRoot, 'mesh.config.ts'))

    await new MeshStateStore('obs-test', stateDir).upsert(record('api-a1', 'api', '/api', logFile))
    const snapshot = await new ObservabilitySnapshotBuilder(config).build({ includeLogs: true, logLines: 1 })

    expect(snapshot.app).toBe('obs-test')
    expect(snapshot.services.find(service => service.service === 'api')?.running).toBe(1)
    expect(snapshot.routes.map(route => route.route)).toContain('/api')
    expect(snapshot.logs?.find(log => log.instanceId === 'api-a1')?.text).toContain('ready')
    expect(snapshot.router.metricsError).toBeTruthy()
  })
})

describe('DashboardRenderer', () => {
  it('renders a stable terminal dashboard without colors when requested', () => {
    const rendered = new DashboardRenderer().render(snapshot(), { colors: false })
    expect(rendered).toContain('@panomapp/mesh dashboard')
    expect(rendered).toContain('Router Metrics')
    expect(rendered).toContain('Services')
    expect(rendered).toContain('/api')
    expect(rendered).not.toContain('\u001b[')
  })
})

function record(id: string, service: string, route: string, logFile: string): MeshInstanceRecord {
  return {
    id,
    service,
    serviceType: 'backend',
    status: 'running',
    pid: process.pid,
    port: 3101,
    host: '127.0.0.1',
    url: 'http://127.0.0.1:3101',
    command: ['node', 'api.js'],
    cwd: process.cwd(),
    logFile,
    startedAt: new Date().toISOString(),
    metadata: { routes: [route] }
  }
}

function snapshot(): MeshDashboardSnapshot {
  return {
    app: 'panom',
    generatedAt: new Date().toISOString(),
    projectRoot: process.cwd(),
    router: {
      enabled: true,
      url: 'http://127.0.0.1:8080',
      metricsPath: '/_mesh/metrics',
      metrics: {
        router: { startedAt: new Date().toISOString(), uptimeMs: 1200, draining: false },
        requests: { total: 4, proxied: 3, noTarget: 1, errors: 0, upgrades: 0 },
        active: { http: 1, sockets: 0, total: 1 },
        services: []
      }
    },
    registry: { type: 'file', ttlMs: 15000, heartbeatIntervalMs: 5000 },
    streaming: { enabled: false, transport: 'memory', logs: true, events: true, keyPrefix: 'mesh:panom' },
    coordination: { enabled: false, backend: 'memory', locks: [], leaders: [] },
    hsm: { enabled: false, routeCount: 0 },
    services: [{ service: 'api', type: 'backend', strategy: 'round-robin', configuredInstances: 1, running: 1, draining: 0, expired: 0, failed: 0, routes: ['/api'] }],
    instances: [],
    routes: [{ service: 'api', route: '/api', source: 'config' }]
  }
}
