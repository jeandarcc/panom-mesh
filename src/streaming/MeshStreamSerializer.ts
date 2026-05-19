import { randomUUID } from 'node:crypto'
import type { MeshStreamEnvelope } from './types.js'

export class MeshStreamSerializer {
  public create<TPayload>(app: string, input: Omit<MeshStreamEnvelope<TPayload>, 'id' | 'emittedAt' | 'app'> & { readonly app?: string }): MeshStreamEnvelope<TPayload> {
    return {
      id: randomUUID(),
      app: input.app ?? app,
      kind: input.kind,
      type: input.type,
      payload: input.payload,
      emittedAt: new Date().toISOString(),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.instanceId !== undefined ? { instanceId: input.instanceId } : {}),
      ...(input.service !== undefined ? { service: input.service } : {})
    }
  }

  public encode(event: MeshStreamEnvelope): string {
    return JSON.stringify(event)
  }

  public decode(value: string): MeshStreamEnvelope | null {
    try {
      const parsed = JSON.parse(value) as Partial<MeshStreamEnvelope>
      if (!parsed || typeof parsed !== 'object') return null
      if (typeof parsed.id !== 'string' || typeof parsed.app !== 'string' || typeof parsed.kind !== 'string' || typeof parsed.type !== 'string') return null
      return parsed as MeshStreamEnvelope
    } catch {
      return null
    }
  }
}
