import type { IncomingHttpHeaders } from 'node:http'
import type { MeshServiceType } from '../core/types.js'

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
])

export class ProxyHeaders {
  public build(
    headers: IncomingHttpHeaders,
    target: URL,
    remoteAddress?: string,
    options: { serviceType?: MeshServiceType; meshCookieName?: string } = {}
  ): IncomingHttpHeaders {
    const next: IncomingHttpHeaders = {}
    for (const [key, value] of Object.entries(headers)) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue
      next[key] = value
    }

    if (options.serviceType === 'frontend') {
      delete next.cookie
    } else if (typeof next.cookie === 'string' && options.meshCookieName) {
      const sanitized = this.stripCookie(next.cookie, options.meshCookieName)
      if (sanitized) next.cookie = sanitized
      else delete next.cookie
    }

    next.host = target.host
    next['x-forwarded-host'] = headers.host
    next['x-forwarded-proto'] = 'http'
    if (remoteAddress) {
      const current = headers['x-forwarded-for']
      next['x-forwarded-for'] = current ? `${String(current)}, ${remoteAddress}` : remoteAddress
    }
    return next
  }

  private stripCookie(cookieHeader: string, cookieName: string): string {
    return cookieHeader
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .filter(part => !part.startsWith(`${cookieName}=`))
      .join('; ')
  }
}
