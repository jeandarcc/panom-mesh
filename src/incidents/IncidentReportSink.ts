import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const INCIDENT_REPORT_PATH = '/api/incidents/report'

const VALID_KINDS = new Set(['MESH_NO_TARGET', 'MESH_ROUTER_DRAINING', 'HSM_TRANSITION_FAILED'])
const MAX_BODY_BYTES = 32_768
const MAX_PAYLOAD_BYTES = 16_384
const MAX_USER_NOTE_LENGTH = 2_000
const MAX_FINGERPRINT_LENGTH = 256

export interface QueuedIncidentReport {
  readonly id: string
  readonly queuedAt: string
  readonly requestId: string
  readonly kind: string
  readonly payload: Record<string, unknown>
  readonly userNote: string | null
  readonly fingerprint: string
  readonly url: string | null
  readonly userAgent: string | null
  readonly source: 'mesh_queue'
}

export class IncidentReportSink {
  private readonly queueFile: string

  public constructor(queueDir: string) {
    fs.mkdirSync(queueDir, { recursive: true })
    this.queueFile = path.join(queueDir, 'pending.jsonl')
  }

  public isReportPath(pathname: string): boolean {
    return this.normalizePath(pathname) === INCIDENT_REPORT_PATH
  }

  public async accept(req: IncomingMessage, res: ServerResponse, requestId: string): Promise<void> {
    try {
      const body = await this.readJsonBody(req)
      const parsed = this.parseReport(body)
      const record: QueuedIncidentReport = {
        id: randomUUID(),
        queuedAt: new Date().toISOString(),
        requestId,
        kind: parsed.kind,
        payload: parsed.payload,
        userNote: parsed.userNote,
        fingerprint: parsed.fingerprint,
        url: parsed.url,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
        source: 'mesh_queue',
      }

      fs.appendFileSync(this.queueFile, `${JSON.stringify(record)}\n`, 'utf8')

      this.respond(res, 201, {
        id: record.id,
        status: 'QUEUED',
        source: 'mesh_queue',
        fingerprint: record.fingerprint,
      })
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode ?? 400
      const message = error instanceof Error ? error.message : 'Invalid incident report'
      this.respond(res, statusCode, { error: 'mesh_incident_rejected', message, requestId })
    }
  }

  private parseReport(body: unknown): {
    kind: string
    payload: Record<string, unknown>
    userNote: string | null
    fingerprint: string
    url: string | null
  } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw Object.assign(new Error('body must be an object'), { statusCode: 400 })
    }

    const record = body as Record<string, unknown>
    const { kind, payload, userNote, fingerprint, url } = record

    if (typeof kind !== 'string' || !VALID_KINDS.has(kind)) {
      throw Object.assign(new Error('Invalid kind'), { statusCode: 400 })
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw Object.assign(new Error('payload must be an object'), { statusCode: 400 })
    }
    if (typeof fingerprint !== 'string' || !fingerprint.trim()) {
      throw Object.assign(new Error('fingerprint is required'), { statusCode: 400 })
    }
    if (fingerprint.length > MAX_FINGERPRINT_LENGTH) {
      throw Object.assign(new Error('fingerprint too long'), { statusCode: 400 })
    }

    const payloadRecord = payload as Record<string, unknown>
    const payloadBytes = Buffer.byteLength(JSON.stringify(payloadRecord), 'utf8')
    if (payloadBytes > MAX_PAYLOAD_BYTES) {
      throw Object.assign(new Error('payload too large'), { statusCode: 413 })
    }

    let normalizedNote: string | null = null
    if (userNote !== undefined && userNote !== null) {
      if (typeof userNote !== 'string') {
        throw Object.assign(new Error('userNote must be a string'), { statusCode: 400 })
      }
      const trimmed = userNote.trim()
      if (trimmed.length > MAX_USER_NOTE_LENGTH) {
        throw Object.assign(new Error('userNote too long'), { statusCode: 400 })
      }
      normalizedNote = trimmed || null
    }

    return {
      kind,
      payload: payloadRecord,
      userNote: normalizedNote,
      fingerprint: fingerprint.trim(),
      url: typeof url === 'string' ? url : null,
    }
  }

  private async readJsonBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0

      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          reject(Object.assign(new Error('body too large'), { statusCode: 413 }))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })

      req.on('end', () => {
        if (chunks.length === 0) {
          reject(Object.assign(new Error('empty body'), { statusCode: 400 }))
          return
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          reject(Object.assign(new Error('invalid json'), { statusCode: 400 }))
        }
      })

      req.on('error', reject)
    })
  }

  private normalizePath(pathname: string): string {
    if (pathname === '/') return '/'
    return `/${pathname.replace(/^\/+|\/+$/g, '')}`
  }

  private respond(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
    res.statusCode = statusCode
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(`${JSON.stringify(body)}\n`)
  }
}
