import process from 'node:process'
import type { NormalizedMeshConfig } from '../core/types.js'
import { InstanceIdResolver } from '../ids/InstanceIdResolver.js'
import { RegistryFactory } from '../registry/RegistryFactory.js'
import { MeshStreamFactory } from './MeshStreamFactory.js'
import type { MeshLogStreamPayload, MeshStreamEnvelope, MeshStreamSubscribeOptions } from './types.js'

export interface MeshStreamCommandOptions extends MeshStreamSubscribeOptions {
  readonly json?: boolean
  readonly raw?: boolean
}

export class StreamCommand {
  public constructor(private readonly config: NormalizedMeshConfig) {}

  public async run(options: MeshStreamCommandOptions = {}): Promise<void> {
    const subscriber = new MeshStreamFactory().createSubscriber(this.config)
    if (!subscriber) throw new Error('Mesh streaming is disabled. Enable streaming in mesh.config.ts.')
    const filters = await this.resolveFilters(options)
    const stop = await subscriber.subscribe(options.types ?? [], event => {
      if (!this.matches(event, filters)) return
      process.stdout.write(this.format(event, options))
    })
    const close = (): void => { void Promise.resolve(stop()).finally(() => process.exit(0)) }
    process.once('SIGINT', close)
    process.once('SIGTERM', close)
    await new Promise<void>(() => undefined)
  }

  private async resolveFilters(options: MeshStreamCommandOptions): Promise<MeshStreamSubscribeOptions> {
    if (!options.instances || options.instances.length === 0) return options
    const registry = new RegistryFactory().create(this.config)
    const instances = await registry.list({ includeExpired: true })
    const resolver = new InstanceIdResolver()
    return {
      ...options,
      instances: options.instances.map(prefix => resolver.resolve(instances, prefix).id)
    }
  }

  private matches(event: MeshStreamEnvelope, options: MeshStreamSubscribeOptions): boolean {
    if (options.kinds && options.kinds.length > 0 && !options.kinds.includes(event.kind)) return false
    if (options.services && options.services.length > 0 && (!event.service || !options.services.includes(event.service))) return false
    if (options.instances && options.instances.length > 0 && (!event.instanceId || !options.instances.includes(event.instanceId))) return false
    return true
  }

  private format(event: MeshStreamEnvelope, options: MeshStreamCommandOptions): string {
    if (options.json) return `${JSON.stringify(event)}\n`
    if (options.raw && event.kind === 'log') return (event.payload as MeshLogStreamPayload).chunk
    if (event.kind === 'log') {
      const payload = event.payload as MeshLogStreamPayload
      const id = event.instanceId ?? 'unknown'
      return `[${id}:${payload.stream}] ${payload.chunk}`
    }
    return `[${event.kind}:${event.type}] ${event.service ?? '-'} ${event.instanceId ?? '-'} ${JSON.stringify(event.payload)}\n`
  }
}
