import crypto from 'node:crypto'

export interface StickyCookiePayload {
  readonly service: string
  readonly nodeId: string
  readonly exp: number
}

export class CookieSigner {
  public constructor(private readonly secret: string) {
    if (!secret || secret.length < 8) {
      throw new Error('Mesh router secret must be at least 8 characters long.')
    }
  }

  public sign(payload: StickyCookiePayload): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const signature = this.hmac(body)
    return `${body}.${signature}`
  }

  public verify(value: string | undefined, expectedService?: string): StickyCookiePayload | null {
    if (!value) return null
    const [body, signature] = value.split('.')
    if (!body || !signature) return null
    if (!this.safeEqual(signature, this.hmac(body))) return null

    try {
      const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<StickyCookiePayload>
      if (!decoded.service || !decoded.nodeId || typeof decoded.exp !== 'number') return null
      if (decoded.exp < Math.floor(Date.now() / 1000)) return null
      if (expectedService && decoded.service !== expectedService) return null
      return { service: decoded.service, nodeId: decoded.nodeId, exp: decoded.exp }
    } catch {
      return null
    }
  }

  private hmac(value: string): string {
    return crypto.createHmac('sha256', this.secret).update(value).digest('base64url')
  }

  private safeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left)
    const b = Buffer.from(right)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  }
}
