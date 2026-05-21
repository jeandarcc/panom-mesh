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

  it('recovers corrupted trailing state and rewrites a clean file', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mesh-state-'))
    const store = new MeshStateStore('test-app', dir)
    const clean = {
      version: 1,
      app: 'test-app',
      updatedAt: new Date().toISOString(),
      instances: [record('api-a')]
    }
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(
      store.statePath,
      `${JSON.stringify(clean, null, 2)}\nthis is trailing garbage from an interrupted mesh run\n`,
      'utf8'
    )

    const recovered = await store.read()
    expect(recovered.instances).toHaveLength(1)
    expect(recovered.instances[0]?.id).toBe('api-a')

    const rewritten = await fs.promises.readFile(store.statePath, 'utf8')
    expect(() => JSON.parse(rewritten)).not.toThrow()
    expect(rewritten).toContain('"instances"')
    expect(rewritten).not.toContain('trailing garbage')
  })

  it('serializes concurrent upserts without losing records', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mesh-state-'))
    const store = new MeshStateStore('test-app', dir)

    await Promise.all(
      Array.from({ length: 20 }, (_, index) => store.upsert(record(`api-${index}`)))
    )

    const state = await store.read()
    expect(state.instances).toHaveLength(20)
    expect(new Set(state.instances.map(item => item.id)).size).toBe(20)

    const written = await fs.promises.readFile(store.statePath, 'utf8')
    expect(() => JSON.parse(written)).not.toThrow()
  })

  it('falls back to backup state when the primary state file is unreadable', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mesh-state-'))
    const store = new MeshStateStore('test-app', dir)
    await store.upsert(record('api-a'))

    await fs.promises.writeFile(store.statePath, '{"version":1,"app":"test-app","instances":[', 'utf8')

    const recovered = await store.read()
    expect(recovered.instances).toHaveLength(1)
    expect(recovered.instances[0]?.id).toBe('api-a')

    const rewritten = await fs.promises.readFile(store.statePath, 'utf8')
    expect(() => JSON.parse(rewritten)).not.toThrow()
  })
})
