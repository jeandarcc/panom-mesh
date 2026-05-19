import type { MeshPsOptions, MeshRunOptions, MeshWatchOptions, NormalizedMeshConfig } from '../core/types.js'
import { InstanceIdResolver } from '../ids/InstanceIdResolver.js'
import { LogStore } from '../logs/LogStore.js'
import { MeshProcessSupervisor } from './MeshProcessSupervisor.js'
import { RegistryFactory } from '../registry/RegistryFactory.js'
import type { MeshRegistry } from '../registry/types.js'
import { PodmanSupervisor } from '../podman/PodmanSupervisor.js'
import { MeshStreamFactory } from '../streaming/MeshStreamFactory.js'
import type { MeshLogStreamPayload } from '../streaming/types.js'

export class MeshRuntime {
  private readonly registry: MeshRegistry
  private readonly logStore: LogStore

  public constructor(private readonly config: NormalizedMeshConfig) {
    this.registry = new RegistryFactory().create(config)
    this.logStore = new LogStore(config.runtime.logsDir)
  }

  public async run(options: MeshRunOptions = {}): Promise<void> {
    if (this.config.runtime.mode === 'podman') {
      await new PodmanSupervisor(this.config).run(options)
      return
    }
    await new MeshProcessSupervisor(this.config).run(options)
  }

  public async ps(options: MeshPsOptions = {}): Promise<string> {
    const instances = await this.registry.list({ includeExpired: true })

    if (options.json) return `${JSON.stringify(instances, null, 2)}\n`
    if (instances.length === 0) return 'No mesh instances found.\n'

    const rows = instances.map(instance => ({
      id: instance.id,
      service: instance.service,
      status: instance.status,
      port: instance.port === null ? '-' : String(instance.port),
      pid: instance.pid === null ? '-' : String(instance.pid),
      url: instance.url ?? '-',
      seen: instance.lastSeenAt ? this.age(instance.lastSeenAt) : '-'
    }))

    return this.table(rows)
  }

  public async watch(prefix: string, options: MeshWatchOptions = {}): Promise<() => void> {
    const instances = await this.registry.list({ includeExpired: true })
    const instance = new InstanceIdResolver().resolve(instances, prefix)
    const last = await this.logStore.readLastLines(instance.logFile, options.lines ?? 80)
    if (last) process.stdout.write(`${last}\n`)
    if (options.stream) {
      const subscriber = new MeshStreamFactory().createSubscriber(this.config)
      if (!subscriber) return this.logStore.tail(instance.logFile, chunk => process.stdout.write(chunk))
      return Promise.resolve(subscriber.subscribe(['mesh.log'], event => {
        if (event.instanceId !== instance.id) return
        const payload = event.payload as MeshLogStreamPayload
        process.stdout.write(payload.chunk)
      })).then(stop => () => { void stop() })
    }
    return this.logStore.tail(instance.logFile, chunk => process.stdout.write(chunk))
  }

  private table(rows: readonly Record<string, string>[]): string {
    const headers = ['ID', 'SERVICE', 'STATUS', 'PORT', 'PID', 'URL', 'LAST SEEN']
    const keys = ['id', 'service', 'status', 'port', 'pid', 'url', 'seen']
    const widths = keys.map((key, index) => Math.max(headers[index]!.length, ...rows.map(row => row[key]!.length)))
    const format = (values: readonly string[]) => values.map((value, index) => value.padEnd(widths[index]!)).join('  ')
    return `${format(headers)}\n${format(widths.map(width => '-'.repeat(width)))}\n${rows.map(row => format(keys.map(key => row[key]!))).join('\n')}\n`
  }

  private age(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime()
    if (!Number.isFinite(ms) || ms < 0) return 'now'
    if (ms < 1_000) return 'now'
    if (ms < 60_000) return `${Math.floor(ms / 1_000)}s ago`
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
    return `${Math.floor(ms / 3_600_000)}h ago`
  }
}
