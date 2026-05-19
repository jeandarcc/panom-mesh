import { SimpleRedisClient, type SimpleRedisClientOptions } from '../../registry/redis/SimpleRedisClient.js'
import { LockLease } from '../LockLease.js'
import type { MeshLockAcquireOptions, MeshLockBackend, MeshLockLease, MeshLockRecord } from '../types.js'

export interface RedisLockBackendOptions extends SimpleRedisClientOptions {
  readonly app: string
  readonly keyPrefix?: string
}

interface StoredLock {
  readonly key: string
  readonly ownerId: string
  readonly acquiredAt: string
  readonly expiresAt: string
  readonly metadata?: Record<string, unknown>
}

export class RedisLockBackend implements MeshLockBackend {
  public readonly kind = 'redis'
  private readonly client: SimpleRedisClient
  private readonly prefix: string

  public constructor(options: RedisLockBackendOptions) {
    this.client = new SimpleRedisClient(options)
    this.prefix = options.keyPrefix ?? `mesh:${options.app}`
  }

  public async acquire(key: string, ownerId: string, options: MeshLockAcquireOptions = {}): Promise<MeshLockLease | null> {
    const ttlMs = options.ttlMs ?? 30_000
    const acquiredAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + ttlMs).toISOString()
    const stored: StoredLock = { key, ownerId, acquiredAt, expiresAt, ...(options.metadata ? { metadata: options.metadata } : {}) }
    const response = await this.client.command(['SET', this.lockKey(key), JSON.stringify(stored), 'NX', 'PX', ttlMs])
    if (response !== 'OK') return null
    await this.client.command(['SADD', this.indexKey(), key])
    return new LockLease(this, key, ownerId, acquiredAt, expiresAt)
  }

  public async renew(key: string, ownerId: string, ttlMs: number): Promise<boolean> {
    const script = `local v = redis.call('GET', KEYS[1]); if not v then return 0 end; local ok, decoded = pcall(cjson.decode, v); if not ok or decoded.ownerId ~= ARGV[1] then return 0 end; decoded.expiresAt = ARGV[3]; redis.call('SET', KEYS[1], cjson.encode(decoded), 'PX', ARGV[2]); return 1`
    const result = await this.client.command(['EVAL', script, 1, this.lockKey(key), ownerId, ttlMs, new Date(Date.now() + ttlMs).toISOString()])
    return result === 1
  }

  public async release(key: string, ownerId: string): Promise<boolean> {
    const script = `local v = redis.call('GET', KEYS[1]); if not v then return 0 end; local ok, decoded = pcall(cjson.decode, v); if not ok or decoded.ownerId ~= ARGV[1] then return 0 end; redis.call('DEL', KEYS[1]); redis.call('SREM', KEYS[2], ARGV[2]); return 1`
    const result = await this.client.command(['EVAL', script, 2, this.lockKey(key), this.indexKey(), ownerId, key])
    return result === 1
  }

  public async list(): Promise<readonly MeshLockRecord[]> {
    const keys = await this.keys()
    const records: MeshLockRecord[] = []
    const stale: string[] = []
    for (const key of keys) {
      const raw = await this.client.command(['GET', this.lockKey(key)])
      if (typeof raw !== 'string') {
        stale.push(key)
        continue
      }
      try {
        const parsed = JSON.parse(raw) as MeshLockRecord
        records.push(parsed)
      } catch {
        stale.push(key)
      }
    }
    if (stale.length > 0) await this.client.command(['SREM', this.indexKey(), ...stale])
    return records.sort((a, b) => a.key.localeCompare(b.key))
  }

  private async keys(): Promise<readonly string[]> {
    const value = await this.client.command(['SMEMBERS', this.indexKey()])
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  }

  private lockKey(key: string): string { return `${this.prefix}:lock:${key}` }
  private indexKey(): string { return `${this.prefix}:locks` }
}
