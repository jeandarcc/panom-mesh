import type { MeshDashboardRenderOptions, MeshDashboardSnapshot } from './types.js'

export class DashboardRenderer {
  public render(snapshot: MeshDashboardSnapshot, options: MeshDashboardRenderOptions = {}): string {
    const color = (code: string, value: string): string => options.colors === false ? value : `\u001b[${code}m${value}\u001b[0m`
    const lines: string[] = []
    lines.push(color('1;36', `@panomapp/mesh dashboard — ${snapshot.app}`))
    lines.push(`generated: ${snapshot.generatedAt}`)
    lines.push(`router:    ${snapshot.router.enabled ? snapshot.router.url : 'disabled'}${snapshot.router.metricsError ? ` (${snapshot.router.metricsError})` : ''}`)
    lines.push(`registry:  ${snapshot.registry.type}, ttl=${snapshot.registry.ttlMs}ms, heartbeat=${snapshot.registry.heartbeatIntervalMs}ms`)
    lines.push(`streaming: ${snapshot.streaming.enabled ? snapshot.streaming.transport : 'disabled'}${snapshot.streaming.enabled ? `, logs=${snapshot.streaming.logs}, events=${snapshot.streaming.events}` : ''}`)
    if (snapshot.coordination.enabled) lines.push(`coordination: ${snapshot.coordination.backend}, locks=${snapshot.coordination.locks.length}, leaders=${snapshot.coordination.leaders.length}`)
    if (snapshot.hsm.enabled) lines.push(`hsm:       ${snapshot.hsm.schemaId ?? 'schema'}${snapshot.hsm.schemaVersion ? `@${snapshot.hsm.schemaVersion}` : ''}, routes=${snapshot.hsm.routeCount}`)

    if (snapshot.router.metrics) {
      const metrics = snapshot.router.metrics
      lines.push('')
      lines.push(color('1', 'Router Metrics'))
      lines.push(this.table([
        ['uptime', this.duration(metrics.router.uptimeMs)],
        ['draining', String(metrics.router.draining)],
        ['requests', String(metrics.requests.total)],
        ['proxied', String(metrics.requests.proxied)],
        ['errors', String(metrics.requests.errors)],
        ['no target', String(metrics.requests.noTarget)],
        ['upgrades', String(metrics.requests.upgrades)],
        ['active', `${metrics.active.total} total / ${metrics.active.http} http / ${metrics.active.sockets} socket`]
      ], ['METRIC', 'VALUE']))
    }

    lines.push('')
    lines.push(color('1', 'Services'))
    lines.push(this.table(snapshot.services.map(service => [
      service.service,
      service.type,
      service.strategy,
      String(service.configuredInstances),
      String(service.running),
      String(service.draining),
      String(service.expired),
      String(service.failed),
      service.routes.join(', ') || '-'
    ]), ['SERVICE', 'TYPE', 'STRATEGY', 'CFG', 'RUN', 'DRAIN', 'EXP', 'FAIL', 'ROUTES']))

    lines.push('')
    lines.push(color('1', 'Instances'))
    lines.push(this.table(snapshot.instances.map(instance => [
      instance.id,
      instance.service,
      instance.status,
      instance.port === null ? '-' : String(instance.port),
      instance.pid === null ? '-' : String(instance.pid),
      instance.url ?? '-',
      instance.lastSeenAt ? this.age(instance.lastSeenAt) : '-'
    ]), ['ID', 'SERVICE', 'STATUS', 'PORT', 'PID', 'URL', 'LAST SEEN']))


    if (!options.compact && snapshot.coordination.enabled) {
      lines.push('')
      lines.push(color('1', 'Coordination'))
      lines.push(this.table(snapshot.coordination.locks.map(lock => [
        lock.key,
        lock.ownerId,
        this.age(lock.acquiredAt),
        lock.expiresAt,
        lock.metadata?.kind ? String(lock.metadata.kind) : '-'
      ]), ['LOCK', 'OWNER', 'AGE', 'EXPIRES', 'KIND']))
      lines.push('')
      lines.push(color('1', 'Leaders'))
      lines.push(this.table(snapshot.coordination.leaders.map(leader => [
        leader.group,
        leader.leaderId,
        this.age(leader.acquiredAt),
        leader.expiresAt
      ]), ['GROUP', 'LEADER', 'AGE', 'EXPIRES']))
      if (snapshot.coordination.errors?.length) lines.push(`coordination errors: ${snapshot.coordination.errors.join('; ')}`)
    }

    if (!options.compact) {
      lines.push('')
      lines.push(color('1', 'Route Plan'))
      lines.push(this.table(snapshot.routes.map(route => [
        route.route,
        route.service,
        route.source,
        route.stateId ?? '-'
      ]), ['ROUTE', 'SERVICE', 'SOURCE', 'STATE']))
    }

    if (snapshot.logs && snapshot.logs.length > 0) {
      lines.push('')
      lines.push(color('1', 'Logs'))
      for (const log of snapshot.logs) {
        lines.push(color('2', `--- ${log.instanceId} (${log.service}) ${log.logFile}`))
        lines.push(log.text.trimEnd() || '(no log output)')
      }
    }

    return `${lines.join('\n')}\n`
  }

  private table(rows: readonly (readonly string[])[], headers: readonly string[]): string {
    if (rows.length === 0) return '(none)'
    const widths = headers.map((header, index) => Math.max(header.length, ...rows.map(row => (row[index] ?? '').length)))
    const format = (row: readonly string[]): string => row.map((cell, index) => (cell ?? '').padEnd(widths[index] ?? 0)).join('  ')
    return [format(headers), format(widths.map(width => '-'.repeat(width))), ...rows.map(format)].join('\n')
  }

  private duration(ms: number): string {
    if (ms < 1_000) return `${ms}ms`
    if (ms < 60_000) return `${Math.floor(ms / 1_000)}s`
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1_000)}s`
    return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`
  }

  private age(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime()
    if (!Number.isFinite(ms) || ms < 1_000) return 'now'
    if (ms < 60_000) return `${Math.floor(ms / 1_000)}s ago`
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
    return `${Math.floor(ms / 3_600_000)}h ago`
  }
}
