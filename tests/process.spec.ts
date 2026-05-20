import net from 'node:net'
import { describe, expect, it } from 'vitest'
import { PortAllocator } from '../src/process/PortAllocator.js'

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
