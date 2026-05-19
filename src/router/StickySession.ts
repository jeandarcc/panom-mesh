import type { IncomingHttpHeaders } from 'node:http'
import { CookieSigner, type StickyCookiePayload } from './CookieSigner.js'

export interface StickySessionOptions {
  readonly cookieName: string
  readonly secret: string
  readonly ttlSeconds?: number
  readonly secure?: boolean
}

export class StickySession {
  private readonly signer: CookieSigner
  private readonly ttlSeconds: number

  public constructor(private readonly options: StickySessionOptions) {
    this.signer = new CookieSigner(options.secret)
    this.ttlSeconds = options.ttlSeconds ?? 60 * 60 * 24 * 14
  }

  public read(headers: IncomingHttpHeaders, service: string): StickyCookiePayload | null {
    const cookie = headers.cookie
    const value = this.parseCookies(cookie)[this.options.cookieName]
    return this.signer.verify(value, service)
  }

  public createHeader(service: string, nodeId: string): string {
    const payload: StickyCookiePayload = {
      service,
      nodeId,
      exp: Math.floor(Date.now() / 1000) + this.ttlSeconds
    }
    const parts = [
      `${this.options.cookieName}=${this.signer.sign(payload)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax'
    ]
    if (this.options.secure) parts.push('Secure')
    return parts.join('; ')
  }

  private parseCookies(cookieHeader: string | undefined): Record<string, string> {
    const cookies: Record<string, string> = {}
    if (!cookieHeader) return cookies
    for (const part of cookieHeader.split(';')) {
      const index = part.indexOf('=')
      if (index < 0) continue
      const key = part.slice(0, index).trim()
      const value = part.slice(index + 1).trim()
      if (key) cookies[key] = value
    }
    return cookies
  }
}
