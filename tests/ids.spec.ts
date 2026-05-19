import { describe, expect, it } from 'vitest'
import { InstanceIdResolver } from '../src/ids/InstanceIdResolver.js'
import type { MeshInstanceRecord } from '../src/core/types.js'

function record(id: string): MeshInstanceRecord {
  return {
    id,
    service: 'api',
    serviceType: 'backend',
    status: 'running',
    pid: 1,
    port: 3000,
    host: '127.0.0.1',
    url: 'http://127.0.0.1:3000',
    command: ['npm run dev'],
    cwd: process.cwd(),
    logFile: `${id}.log`,
    startedAt: new Date().toISOString()
  }
}

describe('InstanceIdResolver', () => {
  it('resolves unique prefixes', () => {
    const found = new InstanceIdResolver().resolve([record('api-a7f2'), record('api-b91c')], 'a7')
    expect(found.id).toBe('api-a7f2')
  })

  it('rejects ambiguous prefixes', () => {
    expect(() => new InstanceIdResolver().resolve([record('api-a7f2'), record('api-a7ff')], 'api-a7')).toThrow(/Ambiguous/)
  })
})
