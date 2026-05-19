import net from 'node:net'
import type { MeshConnectionCounters } from '../core/types.js'

export interface ActiveConnectionSnapshot {
  readonly total: MeshConnectionCounters
  readonly byInstance: Readonly<Record<string, MeshConnectionCounters>>
}

export class ActiveConnectionTracker {
  private readonly http = new Map<string, number>()
  private readonly sockets = new Map<string, Set<net.Socket>>()
  private readonly waiters = new Set<() => void>()

  public beginHttp(instanceId: string): () => void {
    this.http.set(instanceId, (this.http.get(instanceId) ?? 0) + 1)
    let ended = false
    return () => {
      if (ended) return
      ended = true
      this.http.set(instanceId, Math.max(0, (this.http.get(instanceId) ?? 0) - 1))
      this.notifyIfIdle()
    }
  }

  public trackSocket(instanceId: string, ...tracked: net.Socket[]): () => void {
    let set = this.sockets.get(instanceId)
    if (!set) {
      set = new Set()
      this.sockets.set(instanceId, set)
    }
    for (const socket of tracked) set.add(socket)

    let ended = false
    const done = (): void => {
      if (ended) return
      ended = true
      const current = this.sockets.get(instanceId)
      if (current) {
        for (const socket of tracked) current.delete(socket)
        if (current.size === 0) this.sockets.delete(instanceId)
      }
      this.notifyIfIdle()
    }

    for (const socket of tracked) {
      socket.once('close', done)
      socket.once('error', done)
    }

    return done
  }

  public snapshot(): ActiveConnectionSnapshot {
    const ids = new Set([...this.http.keys(), ...this.sockets.keys()])
    const byInstance: Record<string, MeshConnectionCounters> = {}
    let totalHttp = 0
    let totalSockets = 0

    for (const id of ids) {
      const http = this.http.get(id) ?? 0
      const sockets = this.sockets.get(id)?.size ?? 0
      byInstance[id] = { http, sockets, total: http + sockets }
      totalHttp += http
      totalSockets += sockets
    }

    return {
      total: { http: totalHttp, sockets: totalSockets, total: totalHttp + totalSockets },
      byInstance
    }
  }

  public isIdle(): boolean {
    return this.snapshot().total.total === 0
  }

  public async waitForIdle(timeoutMs: number): Promise<boolean> {
    if (this.isIdle()) return true
    if (timeoutMs <= 0) return false

    return await new Promise<boolean>(resolve => {
      const timeout = setTimeout(() => {
        this.waiters.delete(done)
        resolve(false)
      }, timeoutMs)
      timeout.unref?.()

      const done = (): void => {
        clearTimeout(timeout)
        this.waiters.delete(done)
        resolve(true)
      }

      this.waiters.add(done)
    })
  }

  public destroySockets(): void {
    for (const set of this.sockets.values()) {
      for (const socket of set) socket.destroy()
    }
    this.notifyIfIdle()
  }

  private notifyIfIdle(): void {
    if (!this.isIdle()) return
    for (const waiter of Array.from(this.waiters)) waiter()
  }
}
