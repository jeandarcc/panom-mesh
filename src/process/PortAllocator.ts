import net from 'node:net'
import type { MeshPortRange } from '../core/types.js'

export class PortAllocator {
  private readonly reserved = new Set<number>()

  public async reservePreferred(preferred: number | undefined, range: MeshPortRange): Promise<number> {
    if (preferred !== undefined && !this.reserved.has(preferred) && await this.isAvailable(preferred)) {
      this.reserved.add(preferred)
      return preferred
    }

    for (let port = range.from; port <= range.to; port += 1) {
      if (this.reserved.has(port)) continue
      if (await this.isAvailable(port)) {
        this.reserved.add(port)
        return port
      }
    }

    throw new Error(`No available port in range ${range.from}-${range.to}.`)
  }

  private async isAvailable(port: number): Promise<boolean> {
    return new Promise(resolve => {
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => {
        server.close(() => resolve(true))
      })
      server.listen(port, '127.0.0.1')
    })
  }
}
