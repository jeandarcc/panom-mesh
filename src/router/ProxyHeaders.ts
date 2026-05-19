import type { IncomingHttpHeaders } from 'node:http'

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
  public build(headers: IncomingHttpHeaders, target: URL, remoteAddress?: string): IncomingHttpHeaders {
    const next: IncomingHttpHeaders = {}
    for (const [key, value] of Object.entries(headers)) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue
      next[key] = value
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
}
