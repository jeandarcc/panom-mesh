import http from 'node:http'
import fs from 'node:fs'
import crypto from 'node:crypto'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MeshConfigNormalizer } from '../src/config/MeshConfigNormalizer.js'
import { MeshRouterServer } from '../src/router/MeshRouterServer.js'
import { ProxyHeaders } from '../src/router/ProxyHeaders.js'
import { RouteMatcher } from '../src/router/RouteMatcher.js'
import { StickySession } from '../src/router/StickySession.js'
import { MeshStateStore } from '../src/state/MeshStateStore.js'
import type { MeshInstanceRecord } from '../src/core/types.js'

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
})

describe('RouteMatcher', () => {
  it('prefers the most specific route prefix', () => {
    const matcher = new RouteMatcher()
    const match = matcher.match('/api/media/1', [
      record('web', '/', 4100),
      record('api', '/api', 4101),
      record('media', '/api/media', 4102)
    ])
    expect(match?.service).toBe('media')
  })
})

describe('StickySession', () => {
  it('signs and verifies service scoped affinity cookies', () => {
    const sticky = new StickySession({ cookieName: 'pm_mesh', secret: 'test-secret-123' })
    const header = sticky.createHeader('api', 'api-a1')
    const payload = sticky.read({ cookie: header.split(';')[0] }, 'api')
    expect(payload?.nodeId).toBe('api-a1')
    expect(sticky.read({ cookie: header.split(';')[0] }, 'web')).toBeNull()
    expect(sticky.read({ cookie: 'pm_mesh=bad.value' }, 'api')).toBeNull()
  })
})

describe('ProxyHeaders', () => {
  it('propagates HTTPS forwarded proto and strips browser cookies for frontend services', () => {
    const headers = new ProxyHeaders().build({
      host: 'dev.panom.app',
      cookie: 'pm_mesh=mesh; panom_access=token; theme=dark'
    }, new URL('http://127.0.0.1:5173/__vite_hmr'), '127.0.0.1', {
      serviceType: 'frontend',
      meshCookieName: 'pm_mesh',
      forwardedProto: 'https'
    })

    expect(headers.cookie).toBeUndefined()
    expect(headers['x-forwarded-proto']).toBe('https')
    expect(headers['x-forwarded-host']).toBe('dev.panom.app')
  })
})

describe('MeshRouterServer', () => {
  it('proxies requests to healthy instances and sets sticky session cookie', async () => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mesh-router-'))
    const stateDir = path.join(projectRoot, '.mesh')
    const api = await listen((req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ url: req.url, service: 'api' }))
    })
    cleanup.push(api.close)

    const routerPort = await freePort()
    const config = new MeshConfigNormalizer().normalize({
      app: 'test',
      router: { port: routerPort, secret: 'test-secret-123' },
      runtime: { stateDir, logsDir: path.join(stateDir, 'logs') },
      services: {
        api: {
          command: 'node server.js',
          route: '/api',
          strategy: 'session-affinity'
        }
      }
    }, projectRoot, path.join(projectRoot, 'mesh.config.ts'))

    const store = new MeshStateStore('test', stateDir)
    await store.upsert(record('api', '/api', api.port, process.pid))

    const router = new MeshRouterServer({ config })
    await router.listen()
    cleanup.push(() => router.close())

    const res = await request(routerPort, '/api/posts?x=1')
    expect(res.status).toBe(200)
    expect(res.body).toContain('/api/posts?x=1')
    expect(res.headers['set-cookie']?.[0]).toContain('pm_mesh=')
  })

  it('does not forward browser cookies to frontend services', async () => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mesh-router-frontend-cookies-'))
    const stateDir = path.join(projectRoot, '.mesh')
    const frontend = await listen((req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ cookie: req.headers.cookie ?? null, service: 'frontend' }))
    })
    cleanup.push(frontend.close)

    const routerPort = await freePort()
    const config = new MeshConfigNormalizer().normalize({
      app: 'test-frontend-cookies',
      router: { port: routerPort, secret: 'test-secret-123' },
      runtime: { stateDir, logsDir: path.join(stateDir, 'logs') },
      services: {
        frontend: {
          type: 'frontend',
          command: 'npm run dev',
          route: '/'
        }
      }
    }, projectRoot, path.join(projectRoot, 'mesh.config.ts'))

    const store = new MeshStateStore('test-frontend-cookies', stateDir)
    await store.upsert({
      ...record('frontend', '/', frontend.port, process.pid),
      serviceType: 'frontend'
    })

    const router = new MeshRouterServer({ config })
    await router.listen()
    cleanup.push(() => router.close())

    const res = await request(routerPort, '/auth', {
      cookie: `pm_mesh=mesh-cookie; session=real-session; theme=dark`
    })
    expect(res.status).toBe(200)
    expect(res.body).toContain('"cookie":null')
  })

  it('strips only mesh sticky cookie for backend services', async () => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mesh-router-backend-cookies-'))
    const stateDir = path.join(projectRoot, '.mesh')
    const api = await listen((req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ cookie: req.headers.cookie ?? null, service: 'api' }))
    })
    cleanup.push(api.close)

    const routerPort = await freePort()
    const config = new MeshConfigNormalizer().normalize({
      app: 'test-backend-cookies',
      router: { port: routerPort, secret: 'test-secret-123' },
      runtime: { stateDir, logsDir: path.join(stateDir, 'logs') },
      services: {
        api: {
          type: 'backend',
          command: 'npm run dev',
          route: '/api'
        }
      }
    }, projectRoot, path.join(projectRoot, 'mesh.config.ts'))

    const store = new MeshStateStore('test-backend-cookies', stateDir)
    await store.upsert(record('api', '/api', api.port, process.pid))

    const router = new MeshRouterServer({ config })
    await router.listen()
    cleanup.push(() => router.close())

    const res = await request(routerPort, '/api/session', {
      cookie: `pm_mesh=mesh-cookie; session=real-session; theme=dark`
    })
    expect(res.status).toBe(200)
    expect(res.body).toContain('session=real-session; theme=dark')
    expect(res.body).not.toContain('pm_mesh=')
  })

  it('forwards websocket upgrade headers to frontend services', async () => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mesh-router-upgrade-'))
    const stateDir = path.join(projectRoot, '.mesh')
    let receivedConnection = ''
    let receivedUpgrade = ''
    let receivedProtocol = ''
    const frontend = await listenUpgrade((req, socket) => {
      receivedConnection = String(req.headers.connection ?? '')
      receivedUpgrade = String(req.headers.upgrade ?? '')
      receivedProtocol = String(req.headers['sec-websocket-protocol'] ?? '')
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Connection: Upgrade',
        'Upgrade: websocket',
        `Sec-WebSocket-Accept: ${websocketAccept(String(req.headers['sec-websocket-key'] ?? ''))}`,
        receivedProtocol ? `Sec-WebSocket-Protocol: ${receivedProtocol}` : '',
        '',
        ''
      ].filter(Boolean).join('\r\n'))
      socket.end()
    })
    cleanup.push(frontend.close)

    const routerPort = await freePort()
    const config = new MeshConfigNormalizer().normalize({
      app: 'test-upgrade',
      router: { port: routerPort, secret: 'test-secret-123' },
      runtime: { stateDir, logsDir: path.join(stateDir, 'logs') },
      services: {
        frontend: {
          type: 'frontend',
          command: 'npm run dev',
          route: '/'
        }
      }
    }, projectRoot, path.join(projectRoot, 'mesh.config.ts'))

    const store = new MeshStateStore('test-upgrade', stateDir)
    await store.upsert({
      ...record('frontend', '/', frontend.port, process.pid),
      serviceType: 'frontend'
    })

    const router = new MeshRouterServer({ config })
    await router.listen()
    cleanup.push(() => router.close())

    const response = await upgradeRequest(routerPort, '/__vite_hmr?token=test-token')
    expect(response).toContain('101 Switching Protocols')
    expect(receivedConnection.toLowerCase()).toContain('upgrade')
    expect(receivedUpgrade.toLowerCase()).toBe('websocket')
    expect(receivedProtocol).toBe('vite-hmr')
  })
})

describe('MeshRouterServer management endpoints', () => {
  it('exposes management metrics without proxying through user routes', async () => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mesh-router-metrics-'))
    const stateDir = path.join(projectRoot, '.mesh')
    const routerPort = await freePort()
    const config = new MeshConfigNormalizer().normalize({
      app: 'test-metrics',
      router: { port: routerPort, secret: 'test-secret-123' },
      runtime: { stateDir, logsDir: path.join(stateDir, 'logs') },
      services: {
        web: {
          command: 'node server.js',
          route: '/'
        }
      }
    }, projectRoot, path.join(projectRoot, 'mesh.config.ts'))

    const router = new MeshRouterServer({ config })
    await router.listen()
    cleanup.push(() => router.close())

    const health = await request(routerPort, '/_mesh/health')
    expect(health.status).toBe(200)
    expect(health.body).toContain('test-metrics')

    const metrics = await request(routerPort, '/_mesh/metrics')
    expect(metrics.status).toBe(200)
    expect(metrics.body).toContain('requests')
  })
})

function record(service: string, route: string, port: number, pid = process.pid): MeshInstanceRecord {
  return {
    id: `${service}-${port}`,
    service,
    serviceType: service === 'web' ? 'frontend' : 'backend',
    status: 'running',
    pid,
    port,
    host: '127.0.0.1',
    url: `http://127.0.0.1:${port}`,
    command: ['test'],
    cwd: process.cwd(),
    logFile: path.join(os.tmpdir(), `${service}.log`),
    startedAt: new Date().toISOString(),
    metadata: { routes: [route], strategy: 'session-affinity' }
  }
}

async function listen(handler: http.RequestListener): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing test server address')
  return {
    port: address.port,
    close: () => new Promise(resolve => server.close(() => resolve()))
  }
}

async function listenUpgrade(
  upgradeHandler: (req: http.IncomingMessage, socket: net.Socket) => void
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.statusCode = 200
    res.end('ok')
  })
  server.on('upgrade', (req, socket) => upgradeHandler(req, socket))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing test server address')
  return {
    port: address.port,
    close: () => new Promise(resolve => server.close(() => resolve()))
  }
}

async function freePort(): Promise<number> {
  const server = http.createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing address')
  const port = address.port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

async function request(
  port: number,
  pathName: string,
  headers: http.OutgoingHttpHeaders = {}
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathName, headers }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }))
    })
    req.on('error', reject)
    req.end()
  })
}

async function upgradeRequest(port: number, pathName: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write([
        `GET ${pathName} HTTP/1.1`,
        'Host: dev.panom.app',
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Protocol: vite-hmr',
        'Sec-WebSocket-Key: dGVzdC1tZXNoLXJvdXRlcg==',
        '',
        ''
      ].join('\r\n'))
    })

    let response = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => { response += chunk })
    socket.on('end', () => resolve(response))
    socket.on('error', reject)
  })
}

function websocketAccept(key: string): string {
  return crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
}

describe('MeshRouterServer graceful drain', () => {
  it('waits for proxied requests before closing', async () => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mesh-router-drain-'))
    const stateDir = path.join(projectRoot, '.mesh')
    let release!: () => void
    const api = await listen((_req, res) => {
      void new Promise<void>(resolve => { release = resolve }).then(() => res.end('done'))
    })
    cleanup.push(api.close)

    const routerPort = await freePort()
    const config = new MeshConfigNormalizer().normalize({
      app: 'test-drain',
      router: { port: routerPort, secret: 'test-secret-123', drainTimeoutMs: 1_000, socketDrainTimeoutMs: 10 },
      runtime: { stateDir, logsDir: path.join(stateDir, 'logs') },
      services: {
        api: {
          command: 'node server.js',
          route: '/api'
        }
      }
    }, projectRoot, path.join(projectRoot, 'mesh.config.ts'))

    const store = new MeshStateStore('test-drain', stateDir)
    await store.upsert(record('api', '/api', api.port, process.pid))

    const router = new MeshRouterServer({ config })
    await router.listen()
    cleanup.push(() => router.close())

    const pending = request(routerPort, '/api/slow')
    await waitUntil(() => router.connectionSnapshot().total.total > 0 && typeof release === 'function', 1000)
    const closing = router.drainAndClose({ drainTimeoutMs: 1_000 })
    expect(router.connectionSnapshot().total.total).toBeGreaterThan(0)
    release()
    expect((await pending).body).toBe('done')
    const result = await closing
    expect(result.idle).toBe(true)
  })
})

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for condition')
}
