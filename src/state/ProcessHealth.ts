import type { MeshInstanceRecord } from '../core/types.js'

export class ProcessHealth {
  public isAlive(pid: number | null): boolean {
    if (pid === null) return false
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  public refresh(instance: MeshInstanceRecord): MeshInstanceRecord {
    if (instance.status === 'stopped' || instance.status === 'failed') return instance
    return this.isAlive(instance.pid)
      ? { ...instance, status: 'running' }
      : { ...instance, status: 'unknown' }
  }
}
