import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface MeshNoTargetContext {
  readonly pathname: string
  readonly requestId: string
  readonly attemptedUrl?: string
}

export class ErrorPageServer {
  public constructor(private readonly errorPagesDir: string | undefined) {}

  public tryServe(pathname: string, res: ServerResponse): boolean {
    if (!this.errorPagesDir) return false
    if (!pathname.startsWith('/errors/')) return false

    const relative = pathname.slice('/errors/'.length)
    if (!relative || relative.includes('..') || relative.includes('\\')) return false

    const filePath = path.join(this.errorPagesDir, relative)
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false

    const html = fs.readFileSync(filePath, 'utf8')
    res.statusCode = 200
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(html)
    return true
  }

  public serveMeshNoTarget(req: IncomingMessage, res: ServerResponse, context: MeshNoTargetContext): boolean {
    if (!this.errorPagesDir) return false
    if (!this.wantsHtml(req)) return false

    const templatePath = path.join(this.errorPagesDir, 'mesh-no-target.html')
    if (!fs.existsSync(templatePath)) return false

    const proto = this.forwardedProto(req)
    const host = req.headers.host ?? 'localhost'
    const attemptedUrl = context.attemptedUrl ?? `${proto}://${host}${context.pathname}`

    const inject = `<script>window.__PANOM_MESH_INCIDENT__=${JSON.stringify({
      pathname: context.pathname,
      requestId: context.requestId,
      attemptedUrl,
    })}</script>`

    const html = fs.readFileSync(templatePath, 'utf8').replace('</head>', `${inject}</head>`)

    res.statusCode = 503
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(html)
    return true
  }

  private wantsHtml(req: IncomingMessage): boolean {
    const accept = req.headers.accept ?? ''
    if (typeof accept !== 'string') return false
    if (accept.includes('text/html')) return true
    if (accept.includes('*/*') && !accept.includes('application/json')) return true
    return accept === '' || accept === '*/*'
  }

  private forwardedProto(req: IncomingMessage): 'http' | 'https' {
    const header = req.headers['x-forwarded-proto']
    const value = Array.isArray(header) ? header[0] : header
    if (value === 'https') return 'https'
    const socket = req.socket as IncomingMessage['socket'] & { encrypted?: boolean }
    return socket.encrypted ? 'https' : 'http'
  }
}
