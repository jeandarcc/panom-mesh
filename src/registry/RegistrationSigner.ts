import crypto from 'node:crypto'
import type { MeshInstanceRecord } from '../core/types.js'

export interface RegistrationSignaturePayload {
  readonly app: string
  readonly id: string
  readonly service: string
  readonly serviceType: string
  readonly url: string | null
  readonly pid: number | null
  readonly issuedAt: string
}

export class RegistrationSigner {
  public constructor(
    private readonly app: string,
    private readonly secret: string
  ) {}

  public sign(instance: MeshInstanceRecord, issuedAt = new Date().toISOString()): string {
    return this.hmac(this.payload(instance, issuedAt))
  }

  public attach(instance: MeshInstanceRecord, issuedAt = new Date().toISOString()): MeshInstanceRecord {
    const signature = this.sign(instance, issuedAt)
    return {
      ...instance,
      metadata: {
        ...(instance.metadata ?? {}),
        registration: {
          app: this.app,
          issuedAt,
          signature
        }
      }
    }
  }

  public verify(instance: MeshInstanceRecord): boolean {
    const registration = this.registration(instance)
    if (!registration) return false
    const expected = this.sign(instance, registration.issuedAt)
    return this.safeEqual(expected, registration.signature)
  }

  private payload(instance: MeshInstanceRecord, issuedAt: string): RegistrationSignaturePayload {
    return {
      app: this.app,
      id: instance.id,
      service: instance.service,
      serviceType: instance.serviceType,
      url: instance.url,
      pid: instance.pid,
      issuedAt
    }
  }

  private hmac(payload: RegistrationSignaturePayload): string {
    return crypto.createHmac('sha256', this.secret).update(JSON.stringify(payload)).digest('base64url')
  }

  private registration(instance: MeshInstanceRecord): { issuedAt: string; signature: string } | null {
    const value = instance.metadata?.registration
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    if (record.app !== this.app || typeof record.issuedAt !== 'string' || typeof record.signature !== 'string') return null
    return { issuedAt: record.issuedAt, signature: record.signature }
  }

  private safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a)
    const right = Buffer.from(b)
    return left.length === right.length && crypto.timingSafeEqual(left, right)
  }
}
