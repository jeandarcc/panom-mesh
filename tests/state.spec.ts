import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MeshStateStore } from '../src/state/MeshStateStore.js'
import type { MeshInstanceRecord } from '../src/core/types.js'

function record(id: string): MeshInstanceRecord {
  return {
    id,
    service: 'api',
    serviceType: 'backend',
    status: 'running',
    pid: 123,
    port: 3100,
    host: '127.0.0.1',
    url: 'http://127.0.0.1:3100',
    command: ['node server.js'],
    cwd: process.cwd(),
    logFile: 'api.log',
    startedAt: new Date().toISOString()
  }
}

describe('MeshStateStore', () => {
  it('upserts and reads state', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mesh-state-'))
    const store = new MeshStateStore('test-app', dir)
    await store.upsert(record('api-a'))
    await store.upsert(record('api-b'))

    const state = await store.read()
    expect(state.instances.map(item => item.id)).toEqual(['api-a', 'api-b'])
  })
})
