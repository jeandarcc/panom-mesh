import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import type { MeshConnectionCounters, NormalizedMeshConfig } from '../core/types.js'
import { ActiveConnectionTracker, type ActiveConnectionSnapshot } from '../drain/ActiveConnectionTracker.js'
import { InstanceRegistry } from './InstanceRegistry.js'
import { LoadBalancer } from './LoadBalancer.js'
import { ProxyHeaders } from './ProxyHeaders.js'
import { RouteMatcher } from './RouteMatcher.js'
import { StickySession } from './StickySession.js'
import { RouterMetrics } from '../observability/RouterMetrics.js'

export interface MeshRouterServerOptions {
  readonly config: NormalizedMeshConfig
  readonly log?: (line: string) => void
}

export interface MeshRouterDrainResult {
  readonly idle: boolean
  readonly snapshot: ActiveConnectionSnapshot
}

export class MeshRouterServer {
  private readonly server: http.Server
  private readonly registry: InstanceRegistry
  private readonly matcher = new RouteMatcher()
  private readonly headers = new ProxyHeaders()
  private readonly balancer: LoadBalancer
  private readonly tracker = new ActiveConnectionTracker()
  private readonly metrics = new RouterMetrics()
  private readonly instanceService = new Map<string, string>()
  private closed = false
  private draining = false

  public constructor(private readonly options: MeshRouterServerOptions) {
    this.registry = new InstanceRegistry(options.config)
    this.balancer = new LoadBalancer(new StickySession({
      cookieName: options.config.router.cookieName,
      secret: options.config.router.secret,
      secure: options.config.router.secureCookies
    }))
    this.server = http.createServer((req, res) => void this.handle(req, res))
    this.server.on('upgrade', (req, socket, head) => void this.handleUpgrade(req, socket as net.Socket, head))
  }

  public async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.options.config.router.port, this.options.config.router.host, () => {
        this.server.off('error', reject)
        this.log(`mesh router listening on http://${this.options.config.router.host}:${this.options.config.router.port}`)
        resolve()
      })
    })
  }

  public connectionSnapshot(): ActiveConnectionSnapshot {
    return this.tracker.snapshot()
  }

  public async close(): Promise<void> {
    await this.drainAndClose({
      drainTimeoutMs: this.options.config.router.drainTimeoutMs,
      socketDrainTimeoutMs: this.options.config.router.socketDrainTimeoutMs
    })
  }

  public async drainAndClose(options: { readonly drainTimeoutMs?: number; readonly socketDrainTimeoutMs?: number } = {}): Promise<MeshRouterDrainResult> {
    if (this.closed) return { idle: true, snapshot: this.tracker.snapshot() }
    this.closed = true
    this.draining = true

    await new Promise<void>(resolve => this.server.close(() => resolve()))
    const drainTimeoutMs = options.drainTimeoutMs ?? this.options.config.router.drainTimeoutMs
    const socketDrainTimeoutMs = options.socketDrainTimeoutMs ?? this.options.config.router.socketDrainTimeoutMs
    const httpIdle = await this.tracker.waitForIdle(drainTimeoutMs)

    if (!httpIdle && socketDrainTimeoutMs >= 0) {
      this.tracker.destroySockets()
      await this.tracker.waitForIdle(socketDrainTimeoutMs)
    }

    const snapshot = this.tracker.snapshot()
    this.log(`router drained: idle=${snapshot.total.total === 0} active=${snapshot.total.total}`)
    return { idle: snapshot.total.total === 0, snapshot }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = randomUUID().slice(0, 8)
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      if (this.handleManagement(url, req, res)) return
      if (this.draining) {
        this.respond(res, 503, { error: 'mesh_router_draining', requestId })
        return
      }

      const routed = await this.selectTarget(url.pathname, req)
      if (!routed) {
        this.metrics.recordNoTarget()
        this.respond(res, 503, { error: 'mesh_no_target', requestId })
        return
      }

      const { instance, service, target, setCookie } = routed
      this.metrics.recordProxy(service)
      if (setCookie) res.setHeader('Set-Cookie', setCookie)
      this.balancer.begin(instance.id)
      const endTracked = this.tracker.beginHttp(instance.id)
      await this.proxyHttp(req, res, target, requestId, instance.serviceType)
        .finally(() => {
          endTracked()
          this.balancer.end(instance.id)
        })
    } catch (error) {
      this.metrics.recordError()
      this.respond(res, 502, { error: 'mesh_proxy_error', message: (error as Error).message, requestId })
    }
  }

  private async handleUpgrade(req: IncomingMessage, socket: net.Socket, head: Buffer): Promise<void> {
    if (this.draining) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }

    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
      const routed = await this.selectTarget(url.pathname, req)
      if (!routed) {
        this.metrics.recordNoTarget()
        socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      const { instance, service, target } = routed
      this.metrics.recordUpgrade(service)
      this.balancer.begin(instance.id)
      const targetSocket = net.connect(Number(target.port || 80), target.hostname, () => {
        const path = `${target.pathname}${target.search}`
        const proxiedHeaders = this.headers.build(req.headers, target, req.socket.remoteAddress, {
          serviceType: instance.serviceType,
          meshCookieName: this.options.config.router.cookieName
        })
        targetSocket.write(`${req.method ?? 'GET'} ${path} HTTP/${req.httpVersion}\r\n`)
        for (const [key, value] of Object.entries(proxiedHeaders)) {
          if (key.toLowerCase() === 'host') continue
          if (Array.isArray(value)) {
            for (const item of value) targetSocket.write(`${key}: ${item}\r\n`)
          } else if (value !== undefined) {
            targetSocket.write(`${key}: ${value}\r\n`)
          }
        }
        targetSocket.write(`host: ${target.host}\r\n`)
        targetSocket.write(`x-forwarded-host: ${req.headers.host ?? ''}\r\n`)
        targetSocket.write('x-forwarded-proto: http\r\n')
        targetSocket.write('\r\n')
        if (head.length) targetSocket.write(head)
        targetSocket.pipe(socket)
        socket.pipe(targetSocket)
      })
      const endTracked = this.tracker.trackSocket(instance.id, socket, targetSocket)
      let closed = false
      const close = (): void => {
        if (closed) return
        closed = true
        endTracked()
        this.balancer.end(instance.id)
      }
      socket.once('close', close)
      targetSocket.once('close', close)
      targetSocket.once('error', () => socket.destroy())
      socket.once('error', () => targetSocket.destroy())
    } catch {
      this.metrics.recordError()
      socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
      socket.destroy()
    }
  }

  private async selectTarget(pathname: string, req: IncomingMessage): Promise<{ instance: import('../core/types.js').MeshInstanceRecord; service: string; target: URL; setCookie?: string } | null> {
    const routable = await this.registry.listRoutable()
    const match = this.matcher.match(pathname, routable)
    if (!match) return null

    const service = this.options.config.services.get(match.service)
    if (!service) return null
    const healthy = await this.registry.listHealthyByService(match.service)
    const selection = this.balancer.select(match.service, service.strategy, healthy, req.headers)
    if (!selection || !selection.instance.url) return null
    const target = new URL(req.url ?? '/', selection.instance.url)
    this.instanceService.set(selection.instance.id, match.service)
    return { instance: selection.instance, service: match.service, target, ...(selection.setCookie ? { setCookie: selection.setCookie } : {}) }
  }

  private handleManagement(url: URL, req: IncomingMessage, res: ServerResponse): boolean {
    if (!this.options.config.observability.enabled) return false
    if (req.method !== 'GET') return false
    const base = this.options.config.observability.path
    if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return false

    if (url.pathname === base || url.pathname === `${base}/health`) {
      this.respond(res, 200, { ok: true, app: this.options.config.app, generatedAt: new Date().toISOString(), draining: this.draining })
      return true
    }

    if (url.pathname === `${base}/metrics`) {
      this.respond(res, 200, this.metrics.snapshot(this.tracker.snapshot().total, this.activeByService(), this.draining) as unknown as Record<string, unknown>)
      return true
    }

    if (url.pathname === `${base}/routes`) {
      this.respond(res, 200, { routes: this.routePlan() })
      return true
    }

    this.respond(res, 404, { error: 'mesh_management_not_found' })
    return true
  }

  private activeByService(): ReadonlyMap<string, MeshConnectionCounters> {
    const byService = new Map<string, MeshConnectionCounters>()
    const snapshot = this.tracker.snapshot()
    for (const [instanceId, counters] of Object.entries(snapshot.byInstance)) {
      const service = this.instanceService.get(instanceId) ?? instanceId.split('-')[0] ?? 'unknown'
      const existing = byService.get(service) ?? { http: 0, sockets: 0, total: 0 }
      byService.set(service, {
        http: existing.http + counters.http,
        sockets: existing.sockets + counters.sockets,
        total: existing.total + counters.total
      })
    }
    return byService
  }

  private routePlan(): readonly Record<string, unknown>[] {
    const routes: Record<string, unknown>[] = []
    for (const service of this.options.config.services.values()) {
      for (const route of service.routes) routes.push({ service: service.name, route, strategy: service.strategy })
    }
    routes.sort((a, b) => String(b.route).length - String(a.route).length || String(a.service).localeCompare(String(b.service)))
    return routes
  }


  private async proxyHttp(
    req: IncomingMessage,
    res: ServerResponse,
    target: URL,
    requestId: string,
    serviceType: import('../core/types.js').MeshServiceType
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const proxyReq = http.request(target, {
        method: req.method,
        headers: this.headers.build(req.headers, target, req.socket.remoteAddress, {
          serviceType,
          meshCookieName: this.options.config.router.cookieName
        }),
        timeout: this.options.config.router.requestTimeoutMs
      }, proxyRes => {
        res.statusCode = proxyRes.statusCode ?? 502
        res.statusMessage = proxyRes.statusMessage ?? res.statusMessage
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (value !== undefined) res.setHeader(key, value)
        }
        res.setHeader('x-mesh-request-id', requestId)
        proxyRes.pipe(res)
        proxyRes.once('end', resolve)
      })

      proxyReq.once('timeout', () => {
        proxyReq.destroy(new Error('Target request timed out.'))
      })
      proxyReq.once('error', reject)
      req.pipe(proxyReq)
    })
  }

  private respond(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
    res.statusCode = statusCode
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(`${JSON.stringify(body)}\n`)
  }

  private log(line: string): void {
    this.options.log?.(`[router] ${line}`)
  }
}
