# @panomapp/mesh

Application mesh runtime for multi-instance Node.js apps.

`@panomapp/mesh` gives one config file and one CLI for running frontend, backend, worker and router processes behind a mesh gateway. It supports local process orchestration, health-aware reverse proxying, sticky sessions, Redis-backed service discovery, graceful drain, Podman/Quadlet generation, HSM route mapping, terminal observability, distributed log streaming, distributed locks, leader election and cleanup task primitives.

## Installation

```bash
npm install -D @panomapp/mesh
```

Initialize a project:

```bash
npx @panomapp/mesh init
```

This creates `mesh.config.ts` and package scripts such as `mesh:run`, `mesh:run:all`, `mesh:ps`, `mesh:watch`, `mesh:dashboard`, `mesh:stream`, `mesh:locks`, `mesh:leaders`, `mesh:cleanup` and `mesh:stop`.

## Quick start

```ts
import { defineMeshConfig } from '@panomapp/mesh'

export default defineMeshConfig({
  app: 'my-app',

  router: {
    port: 8080,
    sessionAffinity: true,
    secret: process.env.MESH_SECRET ?? 'dev-only-change-me'
  },

  runtime: {
    mode: 'process',
    portRange: { from: 3100, to: 3999 },
    defaultWatch: true
  },

  services: {
    frontend: {
      type: 'frontend',
      command: 'npm run dev',
      cwd: './frontend',
      instances: 1,
      route: '/',
      port: 5173
    },

    api: {
      type: 'backend',
      command: 'npm run dev',
      cwd: './backend',
      instances: 3,
      route: '/api',
      healthPath: '/health',
      strategy: 'session-affinity'
    },

    worker: {
      type: 'worker',
      command: 'npm run worker',
      cwd: './backend',
      instances: 1,
      watch: false
    }
  }
})
```

Run everything:

```bash
npm run mesh:run:all
```

Run only the backend service:

```bash
npm run mesh:run -- api
```

Scale one service temporarily:

```bash
mesh run api --instances 10
```

List instances:

```bash
mesh ps
```

Watch by unique id prefix:

```bash
mesh watch api-a7
```

## Mesh router

The router is a managed mesh instance. It reverse-proxies requests to healthy service instances based on route ownership.

```txt
client → mesh-router:8080 → api-1 / api-2 / api-3
```

Routing is health-aware. Draining, expired and stopped instances are excluded. `session-affinity` uses an HMAC-signed sticky cookie, so clients cannot forge a node target.

Supported strategies:

- `round-robin`
- `least-connections`
- `session-affinity`

HTTP and WebSocket upgrades are supported.

## Registry

The default registry is file-based and suitable for local development. Redis is recommended for multi-process, Podman or multi-host deployments.

```ts
export default defineMeshConfig({
  app: 'panom',
  router: { secret: process.env.MESH_SECRET! },
  registry: {
    type: 'redis',
    url: process.env.REDIS_URL!,
    secret: process.env.MESH_SECRET!,
    requireSignature: true,
    heartbeatIntervalMs: 5_000,
    ttlMs: 15_000
  },
  services: {
    api: { command: 'node server.js', route: '/api', instances: 4 }
  }
})
```

Redis records are signed when a secret is configured. Expired nodes automatically fall out of routing.

## Distributed coordination

Mesh includes distributed coordination primitives for multi-instance apps.

### Locks

```ts
import { LockFactory } from '@panomapp/mesh/locks'

const locks = new LockFactory().createManager(config, 'api-1')

await locks.runExclusive('media:123:process', async () => {
  await processMedia('123')
}, {
  ttlMs: 30_000,
  waitMs: 5_000,
  metadata: { mediaId: '123' }
})
```

Redis locks are owner-scoped and released only by the owner. Lease renewal is supported for long-running work.

### Leader election

```ts
import { LeaderElection } from '@panomapp/mesh/leader'

const leader = new LeaderElection(locks, 'worker-1')

await leader.runWhenLeader('cleanup', async signal => {
  while (!signal.aborted) {
    await cleanupExpiredFiles()
    await new Promise(resolve => setTimeout(resolve, 60_000))
  }
})
```

Leader election is built on the same lock lease mechanism and is useful for cron-like tasks that must not run on every backend instance.

### Cleanup scheduler

```ts
import { CleanupScheduler } from '@panomapp/mesh/cleanup'

const cleanup = new CleanupScheduler({ locks, leader })

cleanup.task('temp-media', {
  intervalMs: 10 * 60_000,
  leader: true,
  lockKey: 'cleanup:temp-media',
  maxRuntimeMs: 5 * 60_000,
  run: async ({ signal }) => {
    await deleteExpiredTempMedia({ signal })
  }
})

cleanup.start()
```

The scheduler is app-agnostic. It does not delete anything by itself; it provides safe execution rules for your cleanup code.

## Observability

Open the terminal dashboard:

```bash
mesh dashboard
```

Render once:

```bash
mesh dashboard --once
mesh dashboard --json
```

Dashboard sections include router metrics, services, instances, route plan, HSM-derived routes, active locks and leaders.

Distributed log/event streaming:

```bash
mesh stream
mesh stream api-a7
mesh stream --service api --kind log
mesh watch api-a7 --stream
```

With Redis streaming enabled, logs/events from multiple processes or hosts can be consumed from one terminal.

## Podman and Quadlet

Podman mode is designed for a single VM deployment where you want repeatable multi-instance containers without hand-writing proxy config.

```ts
export default defineMeshConfig({
  app: 'panom',
  router: { port: 8080, secret: process.env.MESH_SECRET! },
  registry: {
    type: 'redis',
    url: 'redis://panom-redis:6379',
    secret: process.env.MESH_SECRET!,
    requireSignature: true
  },
  runtime: {
    mode: 'podman',
    podman: {
      network: 'panom-mesh',
      containerPrefix: 'panom',
      redis: { enabled: true, containerName: 'panom-redis' },
      quadlet: { outputDir: '.mesh/quadlet', user: true }
    }
  },
  services: {
    api: {
      type: 'backend',
      image: 'ghcr.io/you/my-api:latest',
      command: 'node dist/server.js',
      route: '/api',
      port: 3000,
      instances: 3,
      healthPath: '/health',
      strategy: 'session-affinity',
      podman: { containerPort: 3000 }
    }
  }
})
```

Commands:

```bash
mesh podman:plan
mesh podman:generate --force
mesh run --all
mesh podman:stop api
```

## HSM bridge

If you use `@panomapp/hsm`, Mesh can derive route ownership from a compiled HSM schema.

```ts
export default defineMeshConfig({
  app: 'panom',
  hsm: {
    schemaPath: './hsm.schema.json',
    routeMode: 'both',
    mappings: [
      { service: 'frontend', tags: ['public', 'app'], includeBackendRoutes: false },
      { service: 'api', states: ['app.*', 'cloud.*'], includeCanonicalRoutes: false }
    ]
  },
  services: {
    frontend: { type: 'frontend', command: 'npm run dev', route: '/' },
    api: { type: 'backend', command: 'npm run dev', route: '/api' }
  }
})
```

Inspect the derived plan:

```bash
mesh hsm:plan
mesh hsm:plan --json
```

## CLI reference

```txt
mesh init
mesh run [service]
mesh run --all
mesh ps [--json]
mesh watch <id-prefix> [--stream]
mesh stream [id-prefix]
mesh dashboard [--once] [--json] [--logs]
mesh locks [--json]
mesh leaders [--json]
mesh cleanup [--json]
mesh stop [service|id-prefix]
mesh hsm:plan [--json]
mesh podman:plan [--json]
mesh podman:generate [--force]
mesh podman:stop [target]
```

## Security notes

- Use a strong `MESH_SECRET` in any shared or production environment.
- Do not use `dev-only-change-me` or `dev-only-mesh-secret` outside local development.
- Prefer Redis registry with `requireSignature: true` when nodes register across processes, containers or hosts.
- Keep backend instances on an internal network; expose the mesh router through Nginx/Caddy or another TLS edge.
- Sticky session cookies are HMAC-signed but should not be treated as authentication.
- Frontend checks are UX only. Backend authorization remains mandatory.
- Tune request timeouts, body limits and drain timeouts for your application.

## Exports

```txt
@panomapp/mesh
@panomapp/mesh/config
@panomapp/mesh/runtime
@panomapp/mesh/router
@panomapp/mesh/registry
@panomapp/mesh/registry/redis
@panomapp/mesh/node
@panomapp/mesh/events
@panomapp/mesh/drain
@panomapp/mesh/podman
@panomapp/mesh/hsm
@panomapp/mesh/observability
@panomapp/mesh/streaming
@panomapp/mesh/locks
@panomapp/mesh/leader
@panomapp/mesh/cleanup
```

## License

MIT
