#!/usr/bin/env node
import type { MeshRunOptions } from '../core/types.js'
import { MeshConfigLoader } from '../config/MeshConfigLoader.js'
import { MeshRuntime } from '../runtime/MeshRuntime.js'
import { InitCommand } from './InitCommand.js'
import { StopCommand } from './StopCommand.js'
import { flagBoolean, flagNumber, parseArgs } from './args.js'
import { MeshRouterServer } from '../router/MeshRouterServer.js'
import { PodmanCommands } from '../podman/PodmanCommands.js'
import { PodmanSupervisor } from '../podman/PodmanSupervisor.js'
import { HsmMeshPlanner } from '../hsm/HsmMeshPlanner.js'
import { DashboardCommand } from '../observability/DashboardCommand.js'
import { StreamCommand } from '../streaming/StreamCommand.js'
import { LockFactory } from '../locks/LockFactory.js'
import { LeaderElection } from '../leader/LeaderElection.js'

async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv)

  if (args.command === 'help' || args.command === '--help' || args.command === '-h') {
    process.stdout.write(help())
    return
  }

  if (args.command === 'init') {
    process.stdout.write(await new InitCommand().run())
    return
  }

  const config = await new MeshConfigLoader().load(stringFlag(args.flags, 'config'))
  const runtime = new MeshRuntime(config)


  if (args.command === 'router') {
    const server = new MeshRouterServer({
      config,
      log: line => process.stdout.write(`${line}\n`)
    })
    await server.listen()
    const close = (): void => {
      void server.drainAndClose().finally(() => {
        process.exitCode = 0
        process.exit()
      })
    }
    process.once('SIGINT', close)
    process.once('SIGTERM', close)
    await new Promise<void>(() => undefined)
    return
  }



  if (args.command === 'stream') {
    const streamOptions: Record<string, unknown> = {
      json: Boolean(args.flags.get('json')),
      raw: Boolean(args.flags.get('raw'))
    }
    const kind = stringFlag(args.flags, 'kind')
    const service = stringFlag(args.flags, 'service')
    const instance = stringFlag(args.flags, 'instance') ?? args.positionals[0]
    const type = stringFlag(args.flags, 'type')
    if (kind) streamOptions.kinds = kind.split(',') as import('../streaming/types.js').MeshStreamKind[]
    if (service) streamOptions.services = service.split(',')
    if (instance) streamOptions.instances = [instance]
    if (type) streamOptions.types = type.split(',')
    await new StreamCommand(config).run(streamOptions as import('../streaming/StreamCommand.js').MeshStreamCommandOptions)
    return
  }

  if (args.command === 'dashboard') {
    const dashboardOptions: Record<string, unknown> = {
      json: Boolean(args.flags.get('json')),
      once: Boolean(args.flags.get('once')) || Boolean(args.flags.get('json')),
      compact: flagBoolean(args.flags, 'compact') ?? false
    }
    const colors = flagBoolean(args.flags, 'colors')
    const includeLogs = flagBoolean(args.flags, 'logs')
    const intervalMs = flagNumber(args.flags, 'interval')
    const logLines = flagNumber(args.flags, 'log-lines')
    if (colors !== undefined) dashboardOptions.colors = colors
    if (includeLogs !== undefined) dashboardOptions.includeLogs = includeLogs
    if (intervalMs !== undefined) dashboardOptions.intervalMs = intervalMs
    if (logLines !== undefined) dashboardOptions.logLines = logLines
    const command = new DashboardCommand(config)
    const typedDashboardOptions = dashboardOptions as import('../observability/types.js').MeshDashboardCommandOptions
    if (typedDashboardOptions.once) {
      process.stdout.write(await command.renderOnce(typedDashboardOptions))
      return
    }
    await command.watch(typedDashboardOptions)
    return
  }



  if (args.command === 'locks') {
    const locks = new LockFactory().createManager(config, 'mesh-cli')
    const records = await locks.list()
    if (Boolean(args.flags.get('json'))) {
      process.stdout.write(`${JSON.stringify(records, null, 2)}
`)
      return
    }
    process.stdout.write(table(records.map(lock => ({
      key: lock.key,
      owner: lock.ownerId,
      expires: lock.expiresAt,
      kind: lock.metadata?.kind ? String(lock.metadata.kind) : '-'
    })), ['key', 'owner', 'expires', 'kind'], ['LOCK', 'OWNER', 'EXPIRES', 'KIND']))
    return
  }

  if (args.command === 'leaders') {
    const locks = new LockFactory().createManager(config, 'mesh-cli')
    const leaders = await new LeaderElection(locks, 'mesh-cli').list()
    if (Boolean(args.flags.get('json'))) {
      process.stdout.write(`${JSON.stringify(leaders, null, 2)}
`)
      return
    }
    process.stdout.write(table(leaders.map(leader => ({
      group: leader.group,
      leader: leader.leaderId,
      expires: leader.expiresAt
    })), ['group', 'leader', 'expires'], ['GROUP', 'LEADER', 'EXPIRES']))
    return
  }

  if (args.command === 'cleanup') {
    const snapshot = {
      enabled: config.coordination.cleanup.enabled,
      backend: config.coordination.backend,
      note: 'Programmatic cleanup tasks run inside your app process via CleanupScheduler. Use mesh dashboard for coordination state.'
    }
    process.stdout.write(Boolean(args.flags.get('json')) ? `${JSON.stringify(snapshot, null, 2)}
` : `cleanup: ${snapshot.enabled ? 'enabled' : 'disabled'} (${snapshot.backend})
${snapshot.note}
`)
    return
  }

  if (args.command === 'hsm:plan') {
    process.stdout.write(new HsmMeshPlanner(config).plan({ json: Boolean(args.flags.get('json')) }))
    return
  }

  if (args.command === 'podman:plan') {
    process.stdout.write(await new PodmanCommands(config).plan({ json: Boolean(args.flags.get('json')) }))
    return
  }

  if (args.command === 'podman:generate') {
    const generateOptions: { outputDir?: string; force?: boolean; print?: boolean } = {
      force: Boolean(args.flags.get('force')),
      print: Boolean(args.flags.get('print'))
    }
    const outDir = stringFlag(args.flags, 'out')
    if (outDir !== undefined) generateOptions.outputDir = outDir
    process.stdout.write(await new PodmanCommands(config).generate(generateOptions))
    return
  }

  if (args.command === 'podman:stop') {
    const podmanStopOptions: { force?: boolean; shutdownTimeoutMs?: number } = {
      force: flagBoolean(args.flags, 'force') ?? false
    }
    const podmanShutdownTimeoutMs = flagNumber(args.flags, 'shutdown-timeout')
    if (podmanShutdownTimeoutMs !== undefined) podmanStopOptions.shutdownTimeoutMs = podmanShutdownTimeoutMs
    process.stdout.write(await new PodmanSupervisor(config).stop(args.positionals[0], podmanStopOptions))
    return
  }

  if (args.command === 'run') {
    const runOptions: { services?: readonly string[]; all?: boolean; instances?: number; watch?: boolean; detach?: boolean; router?: boolean; cliPath?: string } = {
      all: Boolean(args.flags.get('all')),
      detach: flagBoolean(args.flags, 'detach') ?? false,
      ...(process.argv[1] ? { cliPath: process.argv[1] } : {})
    }
    const router = flagBoolean(args.flags, 'router')
    if (router !== undefined) runOptions.router = router
    if (args.positionals.length > 0) runOptions.services = args.positionals
    const instances = flagNumber(args.flags, 'instances')
    if (instances !== undefined) runOptions.instances = instances
    const watch = flagBoolean(args.flags, 'watch')
    if (watch !== undefined) runOptions.watch = watch
    await runtime.run(runOptions)
    return
  }

  if (args.command === 'ps') {
    process.stdout.write(await runtime.ps({ json: Boolean(args.flags.get('json')) }))
    return
  }

  if (args.command === 'watch') {
    const id = args.positionals[0]
    if (!id) throw new Error('mesh watch requires an instance id prefix.')
    const watchOptions: { lines?: number; stream?: boolean } = {}
    const lines = flagNumber(args.flags, 'lines')
    if (lines !== undefined) watchOptions.lines = lines
    const stream = flagBoolean(args.flags, 'stream')
    if (stream !== undefined) watchOptions.stream = stream
    await runtime.watch(id, watchOptions)
    await new Promise<void>(() => undefined)
    return
  }

  if (args.command === 'stop') {
    const stopOptions: { drainTimeoutMs?: number; shutdownTimeoutMs?: number; killTimeoutMs?: number; force?: boolean } = {
      force: flagBoolean(args.flags, 'force') ?? false
    }
    const drainTimeoutMs = flagNumber(args.flags, 'drain-timeout')
    const shutdownTimeoutMs = flagNumber(args.flags, 'shutdown-timeout')
    const killTimeoutMs = flagNumber(args.flags, 'kill-timeout')
    if (drainTimeoutMs !== undefined) stopOptions.drainTimeoutMs = drainTimeoutMs
    if (shutdownTimeoutMs !== undefined) stopOptions.shutdownTimeoutMs = shutdownTimeoutMs
    if (killTimeoutMs !== undefined) stopOptions.killTimeoutMs = killTimeoutMs
    process.stdout.write(await new StopCommand(config).run(args.positionals[0], stopOptions))
    return
  }

  throw new Error(`Unknown mesh command: ${args.command}`)
}

function stringFlag(flags: ReadonlyMap<string, string | boolean>, key: string): string | undefined {
  const value = flags.get(key)
  return typeof value === 'string' ? value : undefined
}


function table(rows: readonly Record<string, string>[], keys: readonly string[], headers: readonly string[]): string {
  if (rows.length === 0) return '(none)\n'
  const widths = keys.map((key, index) => Math.max(headers[index]!.length, ...rows.map(row => row[key]!.length)))
  const format = (values: readonly string[]): string => values.map((value, index) => value.padEnd(widths[index]!)).join('  ')
  return `${format(headers)}\n${format(widths.map(width => '-'.repeat(width)))}\n${rows.map(row => format(keys.map(key => row[key]!))).join('\n')}\n`
}

function help(): string {
  return `@panomapp/mesh\n\nCommands:\n  mesh init                 Create mesh.config.ts and package scripts\n  mesh run [service]        Run configured services in process mode\n  mesh run --all            Run all configured services\n  mesh ps                   List known instances\n  mesh watch <id-prefix>    Tail one instance log by unique id prefix
  mesh stream [id-prefix]   Stream distributed mesh logs/events\n  mesh locks                List active distributed locks\n  mesh leaders              List active leader leases\n  mesh cleanup              Show cleanup scheduler integration info\n  mesh stop [service|id]    Stop all or selected instances
  mesh hsm:plan             Print HSM-derived mesh route plan
  mesh podman:plan          Print podman run plan
  mesh podman:generate      Generate Podman Quadlet files
  mesh podman:stop [target] Stop podman-managed containers\n\nOptions:\n  --config <path>           Use a custom config path\n  --instances <n>           Override instance count for selected services\n  --watch=false             Disable live multiplex logs for run\n  --detach                  Start and return immediately
  --router=false            Do not start the mesh router\n  --json                    JSON output for ps/dashboard
  --once                    Render dashboard once and exit
  --interval <ms>           Dashboard refresh interval
  --logs                    Include dashboard log tails
  --log-lines <n>           Lines per instance in dashboard logs
  --stream                  Use distributed stream for watch
  --kind <log,event,...>    Filter mesh stream by kind
  --service <name>          Filter mesh stream by service
  --type <event-type>       Filter mesh stream by event type
  --raw                     Print raw log chunks in mesh stream
  --drain-timeout <ms>      Override graceful drain wait for stop
  --shutdown-timeout <ms>   Override SIGTERM wait for stop
  --out <dir>               Quadlet output directory for podman:generate
  --print                   Print generated Quadlet contents
  --force                   Overwrite Quadlet files or force stop\n`
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
