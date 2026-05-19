import net from 'node:net'
import tls from 'node:tls'

export type RedisCommandArg = string | number

export interface SimpleRedisClientOptions {
  readonly url: string
  readonly connectTimeoutMs?: number
}

export class SimpleRedisClient {
  private readonly url: URL
  private readonly timeoutMs: number

  public constructor(options: SimpleRedisClientOptions) {
    this.url = new URL(options.url)
    this.timeoutMs = options.connectTimeoutMs ?? 5_000
  }

  public async command(args: readonly RedisCommandArg[]): Promise<unknown> {
    const socket = await this.connect()
    try {
      const reader = new RespReader(socket)
      socket.write(this.encode(args))
      return await reader.read()
    } finally {
      socket.end()
    }
  }

  private async connect(): Promise<net.Socket> {
    const port = Number(this.url.port || (this.url.protocol === 'rediss:' ? 6380 : 6379))
    const host = this.url.hostname || '127.0.0.1'
    const socket = this.url.protocol === 'rediss:' ? tls.connect({ port, host }) : net.connect({ port, host })

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy(new Error('Redis connection timed out.'))
      }, this.timeoutMs)
      socket.once('connect', () => {
        clearTimeout(timer)
        resolve()
      })
      socket.once('error', error => {
        clearTimeout(timer)
        reject(error)
      })
    })

    if (this.url.password) {
      if (this.url.username) await this.commandOnSocket(socket, ['AUTH', decodeURIComponent(this.url.username), decodeURIComponent(this.url.password)])
      else await this.commandOnSocket(socket, ['AUTH', decodeURIComponent(this.url.password)])
    }

    const db = this.url.pathname.replace(/^\//, '')
    if (db) await this.commandOnSocket(socket, ['SELECT', db])
    return socket
  }

  private async commandOnSocket(socket: net.Socket, args: readonly RedisCommandArg[]): Promise<unknown> {
    const reader = new RespReader(socket)
    socket.write(this.encode(args))
    return reader.read()
  }

  private encode(args: readonly RedisCommandArg[]): string {
    return `*${args.length}\r\n${args.map(arg => {
      const value = String(arg)
      return `$${Buffer.byteLength(value)}\r\n${value}\r\n`
    }).join('')}`
  }
}

class RespReader {
  private buffer = Buffer.alloc(0)
  private waiters: Array<() => void> = []

  public constructor(private readonly socket: net.Socket) {
    socket.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      for (const waiter of this.waiters.splice(0)) waiter()
    })
  }

  public async read(): Promise<unknown> {
    while (true) {
      const parsed = this.tryParse(0)
      if (parsed) {
        this.buffer = this.buffer.subarray(parsed.offset)
        if (parsed.value instanceof RedisError) throw parsed.value
        return parsed.value
      }
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          cleanup()
          reject(error)
        }
        const onClose = (): void => {
          cleanup()
          reject(new Error('Redis socket closed before response.'))
        }
        const wake = (): void => {
          cleanup()
          resolve()
        }
        const cleanup = (): void => {
          this.socket.off('error', onError)
          this.socket.off('close', onClose)
          const index = this.waiters.indexOf(wake)
          if (index >= 0) this.waiters.splice(index, 1)
        }
        this.socket.once('error', onError)
        this.socket.once('close', onClose)
        this.waiters.push(wake)
      })
    }
  }

  private tryParse(offset: number): { value: unknown; offset: number } | null {
    if (offset >= this.buffer.length) return null
    const type = String.fromCharCode(this.buffer[offset]!)
    const line = this.readLine(offset + 1)
    if (!line) return null

    if (type === '+') return { value: line.text, offset: line.offset }
    if (type === '-') return { value: new RedisError(line.text), offset: line.offset }
    if (type === ':') return { value: Number(line.text), offset: line.offset }
    if (type === '$') {
      const length = Number(line.text)
      if (length === -1) return { value: null, offset: line.offset }
      const end = line.offset + length
      if (this.buffer.length < end + 2) return null
      return { value: this.buffer.subarray(line.offset, end).toString('utf8'), offset: end + 2 }
    }
    if (type === '*') {
      const count = Number(line.text)
      if (count === -1) return { value: null, offset: line.offset }
      const values: unknown[] = []
      let current = line.offset
      for (let index = 0; index < count; index += 1) {
        const item = this.tryParse(current)
        if (!item) return null
        values.push(item.value)
        current = item.offset
      }
      return { value: values, offset: current }
    }
    return null
  }

  private readLine(offset: number): { text: string; offset: number } | null {
    const end = this.buffer.indexOf('\r\n', offset)
    if (end < 0) return null
    return { text: this.buffer.subarray(offset, end).toString('utf8'), offset: end + 2 }
  }
}

class RedisError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'RedisError'
  }
}
