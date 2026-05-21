import fs from 'node:fs'
import path from 'node:path'
import { MeshStateError } from '../core/errors.js'
import type { MeshInstanceRecord, MeshStateFile } from '../core/types.js'
import { atomicWriteJson, ensureDir, pathExists } from '../utils/fs.js'
import { nowIso } from '../utils/time.js'

export class MeshStateStore {
  private lastKnownGood: MeshStateFile | null = null
  private mutationQueue: Promise<void> = Promise.resolve()

  public constructor(
    private readonly app: string,
    private readonly stateDir: string
  ) {}

  public get statePath(): string {
    return path.join(this.stateDir, 'state.json')
  }

  public get backupPath(): string {
    return path.join(this.stateDir, 'state.backup.json')
  }

  public async read(): Promise<MeshStateFile> {
    const direct = await this.readStateFile(this.statePath)
    if (direct) return direct

    const recovered = await this.recoverCorruptedState()
    if (recovered) return recovered

    const backup = await this.readStateFile(this.backupPath)
    if (backup) {
      await atomicWriteJson(this.statePath, backup).catch(() => undefined)
      return backup
    }

    if (this.lastKnownGood) return this.lastKnownGood
    return this.empty()
  }

  public async write(instances: readonly MeshInstanceRecord[]): Promise<void> {
    await this.runMutation(async () => {
      await this.persistState(instances)
    })
  }

  public async upsert(instance: MeshInstanceRecord): Promise<void> {
    await this.runMutation(async () => {
      const state = await this.read()
      const others = state.instances.filter(item => item.id !== instance.id)
      await this.persistState([...others, instance])
    })
  }

  public async update(instanceId: string, patch: Partial<MeshInstanceRecord>): Promise<MeshInstanceRecord> {
    return this.runMutation(async () => {
      const state = await this.read()
      const current = state.instances.find(item => item.id === instanceId)
      if (!current) throw new MeshStateError(`Instance not found in state: ${instanceId}`)
      const next = { ...current, ...patch } as MeshInstanceRecord
      await this.persistState(state.instances.map(item => item.id === instanceId ? next : item))
      return next
    })
  }

  public async remove(instanceIds: readonly string[]): Promise<void> {
    await this.runMutation(async () => {
      const set = new Set(instanceIds)
      const state = await this.read()
      await this.persistState(state.instances.filter(instance => !set.has(instance.id)))
    })
  }

  public empty(): MeshStateFile {
    return {
      version: 1,
      app: this.app,
      updatedAt: nowIso(),
      instances: []
    }
  }

  private parseState(text: string): MeshStateFile {
    const parsed = JSON.parse(text) as MeshStateFile
    if (parsed.version !== 1) throw new MeshStateError(`Unsupported mesh state version: ${String(parsed.version)}`)
    return parsed
  }

  private async recoverCorruptedState(): Promise<MeshStateFile | null> {
    if (!(await pathExists(this.statePath))) return null

    const text = await fs.promises.readFile(this.statePath, 'utf8')
    const prefix = this.extractRootJsonPrefix(text)
    if (!prefix) return null

    try {
      const parsed = this.parseState(prefix)
      await atomicWriteJson(this.statePath, parsed)
      this.lastKnownGood = parsed
      await atomicWriteJson(this.backupPath, parsed).catch(() => undefined)
      return parsed
    } catch {
      return null
    }
  }

  private async readStateFile(filePath: string): Promise<MeshStateFile | null> {
    if (!(await pathExists(filePath))) return null

    try {
      const text = await fs.promises.readFile(filePath, 'utf8')
      const parsed = this.parseState(text)
      this.lastKnownGood = parsed
      return parsed
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof MeshStateError) {
        return null
      }
      return null
    }
  }

  private async persistState(instances: readonly MeshInstanceRecord[]): Promise<void> {
    await ensureDir(this.stateDir)
    const nextState = {
      version: 1,
      app: this.app,
      updatedAt: nowIso(),
      instances
    } satisfies MeshStateFile

    await atomicWriteJson(this.statePath, nextState)
    this.lastKnownGood = nextState
    await atomicWriteJson(this.backupPath, nextState).catch(() => undefined)
  }

  private async runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.catch(() => undefined).then(operation)
    this.mutationQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private extractRootJsonPrefix(text: string): string | null {
    const start = text.search(/\s*[{[]/)
    if (start < 0) return null

    let depth = 0
    let inString = false
    let escaped = false

    for (let index = start; index < text.length; index += 1) {
      const char = text[index]

      if (inString) {
        if (escaped) {
          escaped = false
          continue
        }
        if (char === '\\') {
          escaped = true
          continue
        }
        if (char === '"') inString = false
        continue
      }

      if (char === '"') {
        inString = true
        continue
      }

      if (char === '{' || char === '[') {
        depth += 1
        continue
      }

      if (char === '}' || char === ']') {
        depth -= 1
        if (depth === 0) {
          return text.slice(start, index + 1)
        }
      }
    }

    return null
  }
}
