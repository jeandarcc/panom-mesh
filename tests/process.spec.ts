import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PortAllocator } from '../src/process/PortAllocator.js'
import { ProcessTakeover } from '../src/process/ProcessTakeover.js'

describe('PortAllocator', () => {
  it('treats wildcard listeners as occupied ports', async () => {
    const server = net.createServer()
    await new Promise<void>(resolve => {
      server.listen({ port: 0, host: '0.0.0.0', exclusive: true }, () => resolve())
    })

    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Expected a numeric port address')

      await expect(new PortAllocator().reservePreferred(address.port, { from: address.port, to: address.port })).rejects.toThrow(/No available port/)
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})

describe('ProcessTakeover', () => {
  it('does not claim ownership for unrelated live processes', async () => {
    const takeover = new ProcessTakeover()
    const matches = await takeover.processMatchesRecord(process.pid, {
      command: ['npm', 'run', 'dev'],
      cwd: path.join(os.tmpdir(), 'mesh-unrelated-process')
    })

    expect(matches).toBe(false)
  })
})
