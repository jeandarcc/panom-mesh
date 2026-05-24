import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileMeshRegistry } from '../src/registry/FileMeshRegistry.js'
import { HeartbeatLoop } from '../src/registry/HeartbeatLoop.js'
import { RegistrationSigner } from '../src/registry/RegistrationSigner.js'
import type { MeshInstanceRecord } from '../src/core/types.js'

function record(id = 'api-a7f2'): MeshInstanceRecord {
  return {
    id,
    service: 'api',
    serviceType: 'backend',
    status: 'running',
    pid: process.pid,
    port: 3101,
    host: '127.0.0.1',
    url: 'http://127.0.0.1:3101',
    command: ['node', 'server.js'],
    cwd: process.cwd(),
    logFile: '.mesh/logs/api-a7f2.log',
    startedAt: new Date().toISOString()
  }
}

describe('registry', () => {
  it('registers, heartbeats, drains and expires records', async () => {
    const dir = path.join(os.tmpdir(), `mesh-registry-${Date.now()}`)
    const registry = new FileMeshRegistry('panom', dir)
    const registered = await registry.register(record(), { ttlMs: 250 })
    expect(registered.lastSeenAt).toBeTruthy()

    expect(await registry.list()).toHaveLength(1)
    await registry.markDraining('api-a7f2')
    expect((await registry.get('api-a7f2'))?.status).toBe('draining')

    await new Promise(resolve => setTimeout(resolve, 275))
    expect(await registry.list()).toHaveLength(0)
    expect(await registry.list({ includeExpired: true })).toHaveLength(1)
  })

  it('signs and verifies registration records', () => {
    const signer = new RegistrationSigner('panom', 'secret')
    const signed = signer.attach(record())
    expect(signer.verify(signed)).toBe(true)
    expect(signer.verify({ ...signed, url: 'http://evil.local:3000' })).toBe(false)
  })

  it('heartbeat timer keeps the event loop alive for supervisors', async () => {
    const registry = {
      heartbeat: async () => undefined,
    }
    const loop = new HeartbeatLoop(registry, 'api-a7f2', 50, 100)
    loop.start()

    const outcome = await Promise.race([
      new Promise<'alive'>((resolve) => setTimeout(() => resolve('alive'), 120)),
      new Promise<'exit'>((resolve) => process.once('beforeExit', () => resolve('exit'))),
    ])

    loop.stop()
    expect(outcome).toBe('alive')
  })
})
