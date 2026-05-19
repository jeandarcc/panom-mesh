import fs from 'node:fs'
import path from 'node:path'
import { MeshStateError } from '../core/errors.js'
import type { MeshInstanceRecord, MeshStateFile } from '../core/types.js'
import { atomicWriteJson, ensureDir, pathExists } from '../utils/fs.js'
import { nowIso } from '../utils/time.js'

export class MeshStateStore {
  public constructor(
    private readonly app: string,
    private readonly stateDir: string
  ) {}

  public get statePath(): string {
    return path.join(this.stateDir, 'state.json')
  }

  public async read(): Promise<MeshStateFile> {
    if (!(await pathExists(this.statePath))) {
      return this.empty()
    }
    try {
      const text = await fs.promises.readFile(this.statePath, 'utf8')
      const parsed = JSON.parse(text) as MeshStateFile
      if (parsed.version !== 1) throw new MeshStateError(`Unsupported mesh state version: ${String(parsed.version)}`)
      return parsed
    } catch (error) {
      if (error instanceof MeshStateError) throw error
      throw new MeshStateError(`Failed to read mesh state: ${(error as Error).message}`)
    }
  }

  public async write(instances: readonly MeshInstanceRecord[]): Promise<void> {
    await ensureDir(this.stateDir)
    await atomicWriteJson(this.statePath, {
      version: 1,
      app: this.app,
      updatedAt: nowIso(),
      instances
    } satisfies MeshStateFile)
  }

  public async upsert(instance: MeshInstanceRecord): Promise<void> {
    const state = await this.read()
    const others = state.instances.filter(item => item.id !== instance.id)
    await this.write([...others, instance])
  }

  public async update(instanceId: string, patch: Partial<MeshInstanceRecord>): Promise<MeshInstanceRecord> {
    const state = await this.read()
    const current = state.instances.find(item => item.id === instanceId)
    if (!current) throw new MeshStateError(`Instance not found in state: ${instanceId}`)
    const next = { ...current, ...patch } as MeshInstanceRecord
    await this.write(state.instances.map(item => item.id === instanceId ? next : item))
    return next
  }

  public async remove(instanceIds: readonly string[]): Promise<void> {
    const set = new Set(instanceIds)
    const state = await this.read()
    await this.write(state.instances.filter(instance => !set.has(instance.id)))
  }

  public empty(): MeshStateFile {
    return {
      version: 1,
      app: this.app,
      updatedAt: nowIso(),
      instances: []
    }
  }
}
