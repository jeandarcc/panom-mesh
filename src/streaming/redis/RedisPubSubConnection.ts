import net from 'node:net'
import tls from 'node:tls'
import type { RedisCommandArg } from '../../registry/redis/SimpleRedisClient.js'

export interface RedisPubSubConnectionOptions {
  readonly url: string
  readonly connectTimeoutMs?: number
}

export class RedisPubSubConnection {
  private socket: net.Socket | null = null
  private reader: RespStreamReader | null = null
  private closed = false

  public constructor(private readonly options: RedisPubSubConnectionOptions) {}

  public async subscribe(channels: readonly string[], onMessage: (channel: string, message: string) => void): Promise<() => Promise<void>> {
    if (channels.length === 0) throw new Error('RedisPubSubConnection.subscribe requires at least one channel.')
    const socket = await this.connect()
    this.socket = socket
    this.reader = new RespStreamReader(socket)
    socket.write(encode(['SUBSCRIBE', ...channels]))

    void this.readLoop(onMessage)

    return async () => {
      this.closed = true
      if (!socket.destroyed) {
        try { socket.write(encode(['UNSUBSCRIBE', ...channels])) } catch { /* noop */ }
        socket.end()
      }
    }
  }

  private async readLoop(onMessage: (channel: string, message: string) => void): Promise<void> {
    const reader = this.reader
    if (!reader) return
    while (!this.closed) {
      try {
        const value = await reader.read()
        if (!Array.isArray(value) || value.length < 3) continue
        const [kind, channel, message] = value
        if (kind === 'message' && typeof channel === 'string' && typeof message === 'string') {
          onMessage(channel, message)
        }
      } catch {
        if (!this.closed) this.closed = true
      }
    }
  }

  private async connect(): Promise<net.Socket> {
    const url = new URL(this.options.url)
    const port = Number(url.port || (url.protocol === 'rediss:' ? 6380 : 6379))
    const host = url.hostname || '127.0.0.1'
    const socket = url.protocol === 'rediss:' ? tls.connect({ port, host }) : net.connect({ port, host })
    const timeoutMs = this.options.connectTimeoutMs ?? 5_000

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy(new Error('Redis pub/sub connection timed out.'))
      }, timeoutMs)
      socket.once('connect', () => {
        clearTimeout(timer)
        resolve()
      })
      socket.once('error', error => {
        clearTimeout(timer)
        reject(error)
      })
    })

    if (url.password) {
      if (url.username) await commandOnSocket(socket, ['AUTH', decodeURIComponent(url.username), decodeURIComponent(url.password)])
      else await commandOnSocket(socket, ['AUTH', decodeURIComponent(url.password)])
    }
    const db = url.pathname.replace(/^\//, '')
    if (db) await commandOnSocket(socket, ['SELECT', db])
    return socket
  }
}

async function commandOnSocket(socket: net.Socket, args: readonly RedisCommandArg[]): Promise<unknown> {
  const reader = new RespStreamReader(socket)
  socket.write(encode(args))
  return reader.read()
}

function encode(args: readonly RedisCommandArg[]): string {
  return `*${args.length}\r\n${args.map(arg => {
    const value = String(arg)
    return `$${Buffer.byteLength(value)}\r\n${value}\r\n`
  }).join('')}`
}

class RespStreamReader {
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
    if (type === '-') throw new Error(line.text)
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
