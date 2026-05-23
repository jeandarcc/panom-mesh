import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { IncidentReportSink } from '../src/incidents/IncidentReportSink.js'

const cleanup: string[] = []
afterEach(() => {
  while (cleanup.length) {
    fs.rmSync(cleanup.pop()!, { recursive: true, force: true })
  }
})

describe('IncidentReportSink', () => {
  it('queues valid incident reports to pending.jsonl', async () => {
    const queueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-incidents-'))
    cleanup.push(queueDir)
    const sink = new IncidentReportSink(queueDir)

    const req = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
      on() {},
      destroy() {},
    } as unknown as import('node:http').IncomingMessage

    const chunks = [
      Buffer.from(JSON.stringify({
        kind: 'MESH_NO_TARGET',
        payload: { pathname: '/api/health' },
        fingerprint: 'mesh:abc',
        url: 'https://example.test/errors',
      })),
    ]

    let dataHandler: ((chunk: Buffer) => void) | undefined
    let endHandler: (() => void) | undefined
    req.on = ((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'data') dataHandler = handler as (chunk: Buffer) => void
      if (event === 'end') endHandler = handler as () => void
      return req
    }) as typeof req.on

    const response = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      setHeader(name: string, value: string) {
        this.headers[name] = value
      },
      end(body: string) {
        this.body = body
      },
      body: '',
    } as import('node:http').ServerResponse & { body: string }

    const acceptPromise = sink.accept(req, response, 'req-test')
    dataHandler?.(chunks[0]!)
    endHandler?.()
    await acceptPromise

    expect(response.statusCode).toBe(201)
    const queueFile = path.join(queueDir, 'pending.jsonl')
    expect(fs.existsSync(queueFile)).toBe(true)
    const line = fs.readFileSync(queueFile, 'utf8').trim()
    const record = JSON.parse(line) as { fingerprint: string; source: string }
    expect(record.fingerprint).toBe('mesh:abc')
    expect(record.source).toBe('mesh_queue')
  })
})
