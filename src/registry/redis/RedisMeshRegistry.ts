import type { MeshInstanceRecord } from '../../core/types.js'
import type { MeshRegistry, MeshRegistryHeartbeatOptions, MeshRegistryListOptions, MeshRegistryRegisterOptions } from '../types.js'
import { RegistryRecordTools } from '../RegistryRecordTools.js'
import { RegistrationSigner } from '../RegistrationSigner.js'
import { SimpleRedisClient, type SimpleRedisClientOptions } from './SimpleRedisClient.js'

export interface RedisMeshRegistryOptions extends SimpleRedisClientOptions {
  readonly app: string
  readonly secret?: string
  readonly keyPrefix?: string
  readonly requireSignature?: boolean
}

export class RedisMeshRegistry implements MeshRegistry {
  public readonly kind = 'redis'
  private readonly client: SimpleRedisClient
  private readonly prefix: string
  private readonly signer: RegistrationSigner | undefined
  private readonly requireSignature: boolean

  public constructor(private readonly options: RedisMeshRegistryOptions) {
    this.client = new SimpleRedisClient(options)
    this.prefix = options.keyPrefix ?? `mesh:${options.app}`
    this.signer = options.secret ? new RegistrationSigner(options.app, options.secret) : undefined
    this.requireSignature = options.requireSignature ?? Boolean(options.secret)
  }

  public async register(instance: MeshInstanceRecord, options: MeshRegistryRegisterOptions = {}): Promise<MeshInstanceRecord> {
    const ttlMs = options.ttlMs ?? 15_000
    const touched = RegistryRecordTools.touch(instance, ttlMs)
    const signed = this.signer ? this.signer.attach(touched) : touched
    await this.client.command(['SADD', this.indexKey(), signed.id])
    await this.client.command(['SET', this.instanceKey(signed.id), JSON.stringify(signed), 'PX', ttlMs])
    return signed
  }

  public async heartbeat(instanceId: string, options: MeshRegistryHeartbeatOptions = {}): Promise<MeshInstanceRecord | null> {
    const current = await this.get(instanceId)
    if (!current) return null
    const ttlMs = options.ttlMs ?? this.remainingTtl(current) ?? 15_000
    const patched = { ...current, ...(options.patch ?? {}) } as MeshInstanceRecord
    const touched = RegistryRecordTools.touch(patched, ttlMs)
    const signed = this.signer ? this.signer.attach(touched) : touched
    await this.client.command(['SET', this.instanceKey(instanceId), JSON.stringify(signed), 'PX', ttlMs])
    return signed
  }

  public async list(options: MeshRegistryListOptions = {}): Promise<readonly MeshInstanceRecord[]> {
    const ids = await this.ids()
    const items = await Promise.all(ids.map(id => this.get(id)))
    const now = Date.now()
    const alive: MeshInstanceRecord[] = []
    const staleIds: string[] = []

    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index]!
      const item = items[index]
      if (!item) {
        staleIds.push(id)
        continue
      }
      const refreshed = RegistryRecordTools.markExpired(item, now)
      if (options.service && refreshed.service !== options.service) continue
      if (!options.includeExpired && refreshed.status === 'expired') continue
      alive.push(refreshed)
    }

    if (staleIds.length > 0) await this.client.command(['SREM', this.indexKey(), ...staleIds])
    return alive
  }

  public async get(instanceId: string): Promise<MeshInstanceRecord | null> {
    const raw = await this.client.command(['GET', this.instanceKey(instanceId)])
    if (typeof raw !== 'string') return null
    const parsed = JSON.parse(raw) as MeshInstanceRecord
    if (this.requireSignature && (!this.signer || !this.signer.verify(parsed))) return null
    return parsed
  }

  public async markDraining(instanceId: string): Promise<MeshInstanceRecord | null> {
    const current = await this.get(instanceId)
    if (!current) return null
    return this.heartbeat(instanceId, { patch: { status: 'draining' } })
  }

  public async unregister(instanceId: string): Promise<void> {
    await this.client.command(['DEL', this.instanceKey(instanceId)])
    await this.client.command(['SREM', this.indexKey(), instanceId])
  }

  private async ids(): Promise<readonly string[]> {
    const value = await this.client.command(['SMEMBERS', this.indexKey()])
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  }

  private remainingTtl(instance: MeshInstanceRecord): number | null {
    if (!instance.expiresAt) return null
    return Math.max(1_000, new Date(instance.expiresAt).getTime() - Date.now())
  }

  private indexKey(): string {
    return `${this.prefix}:instances`
  }

  private instanceKey(id: string): string {
    return `${this.prefix}:instance:${id}`
  }
}
