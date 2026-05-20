import { execFile } from 'node:child_process'
import net from 'node:net'
import { promisify } from 'node:util'
import type { MeshInstanceRecord } from '../core/types.js'
import { sleep } from '../utils/time.js'

const execFileAsync = promisify(execFile)

export interface ProcessTakeoverOptions {
  readonly label?: string
  readonly timeoutMs?: number
  readonly quiet?: boolean
}

export class ProcessTakeover {
  public async forceFreePort(port: number, options: ProcessTakeoverOptions = {}): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 2_500
    const deadline = Date.now() + timeoutMs
    const label = options.label ?? `port ${port}`

    while (Date.now() < deadline) {
      const listeners = await this.listListeningPids(port)
      if (listeners.length === 0) {
        if (await this.isAvailable(port)) return
        await sleep(100)
        continue
      }

      if (!options.quiet) {
        console.warn(`[mesh] force-freeing ${label} from PIDs: ${listeners.join(', ')}`)
      }

      await this.signalPids(listeners, 'SIGTERM')
      await sleep(250)

      const remaining = await this.listListeningPids(port)
      if (remaining.length === 0 && await this.isAvailable(port)) return

      if (remaining.length > 0) {
        await this.signalPids(remaining, 'SIGKILL')
        await sleep(250)
      }

      const afterKill = await this.listListeningPids(port)
      if (afterKill.length === 0 && await this.isAvailable(port)) return
    }

    throw new Error(`Mesh could not free ${label}. Another process is still bound after aggressive termination attempts.`)
  }

  public async killPid(pid: number, options: ProcessTakeoverOptions = {}): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 2_500
    const deadline = Date.now() + timeoutMs
    const label = options.label ?? `pid ${pid}`
    let warned = false

    while (Date.now() < deadline) {
      if (!this.isAlive(pid)) return
      if (!options.quiet && !warned) {
        console.warn(`[mesh] terminating ${label}`)
        warned = true
      }
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        return
      }
      await sleep(250)
      if (!this.isAlive(pid)) return
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        return
      }
      await sleep(250)
    }

    if (this.isAlive(pid)) {
      throw new Error(`Mesh could not terminate ${label}.`)
    }
  }

  public async pidOwnsListeningPort(pid: number, port: number): Promise<boolean> {
    const listeners = await this.listListeningPids(port)
    return listeners.includes(pid)
  }

  public async processMatchesRecord(pid: number, record: Pick<MeshInstanceRecord, 'command' | 'cwd'>): Promise<boolean> {
    const commandLine = await this.readCommandLine(pid)
    if (!commandLine) return false

    const expectedTokens = record.command
      .map(token => token.trim())
      .filter(Boolean)
      .filter(token => !token.startsWith('--'))
      .slice(0, 3)

    if (expectedTokens.length > 0 && !expectedTokens.every(token => commandLine.includes(token))) {
      return false
    }

    if (record.cwd) {
      const cwd = await this.readWorkingDirectory(pid)
      if (cwd && cwd !== record.cwd) return false
    }

    return true
  }

  public async listListeningPids(port: number): Promise<number[]> {
    try {
      const { stdout } = await execFileAsync('lsof', ['-nP', '-tiTCP:' + String(port), '-sTCP:LISTEN'])
      return Array.from(new Set(stdout.split(/\s+/).map(value => Number(value.trim())).filter(value => Number.isInteger(value) && value > 0)))
    } catch {
      return []
    }
  }

  private async readCommandLine(pid: number): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'command='])
      const value = stdout.trim()
      return value.length > 0 ? value : null
    } catch {
      return null
    }
  }

  private async readWorkingDirectory(pid: number): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'])
      const line = stdout.split('\n').find(entry => entry.startsWith('n'))
      return line ? line.slice(1) : null
    } catch {
      return null
    }
  }

  public async isAvailable(port: number): Promise<boolean> {
    return await this.canBind(port, '::') && await this.canBind(port, '0.0.0.0')
  }

  private async signalPids(pids: readonly number[], signal: NodeJS.Signals): Promise<void> {
    for (const pid of pids) {
      try {
        process.kill(pid, signal)
      } catch {
        // ignore races with already exited processes
      }
    }
  }

  private async canBind(port: number, host: string): Promise<boolean> {
    return await new Promise<boolean>(resolve => {
      const server = net.createServer()
      server.unref()
      server.once('error', () => resolve(false))
      server.once('listening', () => {
        server.close(() => resolve(true))
      })
      server.listen({ port, host, exclusive: true })
    })
  }

  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
}
