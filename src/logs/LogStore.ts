import fs from 'node:fs'
import path from 'node:path'
import { ensureDir } from '../utils/fs.js'

export class LogStore {
  public constructor(private readonly logsDir: string) {}

  public getLogPath(instanceId: string): string {
    return path.join(this.logsDir, `${instanceId}.log`)
  }

  public async createStream(instanceId: string): Promise<fs.WriteStream> {
    await ensureDir(this.logsDir)
    return fs.createWriteStream(this.getLogPath(instanceId), { flags: 'a' })
  }

  public async readLastLines(logFile: string, lines: number): Promise<string> {
    try {
      const text = await fs.promises.readFile(logFile, 'utf8')
      return text.split(/\r?\n/).slice(-Math.max(1, lines)).join('\n')
    } catch {
      return ''
    }
  }

  public tail(logFile: string, onChunk: (chunk: string) => void): () => void {
    let position = 0
    let closed = false

    const readNew = async (): Promise<void> => {
      if (closed) return
      try {
        const stat = await fs.promises.stat(logFile)
        if (stat.size < position) position = 0
        if (stat.size === position) return
        const handle = await fs.promises.open(logFile, 'r')
        const buffer = Buffer.alloc(stat.size - position)
        await handle.read(buffer, 0, buffer.length, position)
        await handle.close()
        position = stat.size
        onChunk(buffer.toString('utf8'))
      } catch {
        // log file can be created after tail starts
      }
    }

    void readNew()
    const interval = setInterval(() => void readNew(), 500)
    return () => {
      closed = true
      clearInterval(interval)
    }
  }
}
