import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MeshConfigNormalizer } from '../src/config/MeshConfigNormalizer.js'
import { MemoryMeshStream } from '../src/streaming/MemoryMeshStream.js'
import { MeshStreamChannels } from '../src/streaming/MeshStreamChannels.js'
import { MeshStreamSerializer } from '../src/streaming/MeshStreamSerializer.js'
import { MeshRuntime } from '../src/runtime/MeshRuntime.js'
import { MeshStateStore } from '../src/state/MeshStateStore.js'
import type { MeshInstanceRecord } from '../src/core/types.js'

describe('Mesh streaming', () => {
  it('publishes and subscribes to in-memory distributed log envelopes', async () => {
    const config = new MeshConfigNormalizer().normalize({
      app: 'stream-test',
      streaming: { enabled: true, transport: 'memory', maxLogChunkBytes: 8 },
      services: { api: { command: 'node api.js', route: '/api' } }
    })
    const stream = new MemoryMeshStream(config)
    const seen: unknown[] = []
    const stop = await stream.subscribe(['mesh.log'], event => { seen.push(event) })
    await stream.publishLog({ instanceId: 'api-a1', service: 'api', stream: 'stdout', chunk: 'hello world' })
    stop()
    expect(seen).toHaveLength(1)
    expect(JSON.stringify(seen[0])).toContain('hello wo')
    expect(JSON.stringify(seen[0])).toContain('truncated')
  })

  it('resolves stream channels from the configured key prefix', () => {
    const config = new MeshConfigNormalizer().normalize({
      app: 'channel-test',
      registry: { type: 'redis', url: 'redis://localhost:6379', keyPrefix: 'mesh:custom' },
      services: { api: { command: 'node api.js' } }
    })
    const channels = new MeshStreamChannels(config.streaming)
    expect(channels.logs()).toBe('mesh:custom:stream:logs')
    expect(channels.events()).toBe('mesh:custom:stream:events')
  })

  it('round-trips typed stream envelopes', () => {
    const serializer = new MeshStreamSerializer()
    const envelope = serializer.create('panom', { kind: 'event', type: 'media.deleted', service: 'api', payload: { id: 'm1' } })
    expect(serializer.decode(serializer.encode(envelope))).toEqual(envelope)
    expect(serializer.decode('not-json')).toBeNull()
  })

  it('can watch a registry instance through the stream backend', async () => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mesh-stream-watch-'))
    const stateDir = path.join(projectRoot, '.mesh')
    const config = new MeshConfigNormalizer().normalize({
      app: 'stream-watch',
      runtime: { stateDir, logsDir: path.join(stateDir, 'logs') },
      streaming: { enabled: true, transport: 'memory' },
      services: { api: { command: 'node api.js', route: '/api' } }
    }, projectRoot, path.join(projectRoot, 'mesh.config.ts'))
    const logFile = path.join(stateDir, 'logs', 'api-a1.log')
    await fs.promises.mkdir(path.dirname(logFile), { recursive: true })
    await fs.promises.writeFile(logFile, '')
    await new MeshStateStore('stream-watch', stateDir).upsert(record('api-a1', 'api', logFile))
    const stop = await new MeshRuntime(config).watch('api-a1', { stream: true, lines: 1 })
    stop()
  })
})

function record(id: string, service: string, logFile: string): MeshInstanceRecord {
  return {
    id,
    service,
    serviceType: 'backend',
    status: 'running',
    pid: process.pid,
    port: 3101,
    host: '127.0.0.1',
    url: 'http://127.0.0.1:3101',
    command: ['node', 'api.js'],
    cwd: process.cwd(),
    logFile,
    startedAt: new Date().toISOString()
  }
}
