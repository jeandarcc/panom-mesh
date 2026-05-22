# Mesh Quick Start

This chapter gets a working Mesh setup running as quickly as possible.

## Installation

```bash
npm install -D @panomapp/mesh
```

Generate the starter files:

```bash
npx @panomapp/mesh init
cp .meshenv.example .meshenv
```

## Local environment (`.meshenv`)

Mesh loads `.meshenv` from the directory where you run mesh commands (typically the repo root). Values are merged into:

- `process.env` before `mesh.config.ts` is evaluated (so `runtimeEnv()` picks them up)
- every spawned frontend, backend and worker process
- podman container env in podman mode

Use `.meshenv` for local non-secret overrides you do not want in GitHub Actions secrets:

```env
AUTH_COOKIE_DOMAIN=.panom.app
CORS_ALLOWED_ORIGINS=https://dev.panom.app:3000,https://dev.panom.app
APP_URL=https://dev.panom.app:3000
```

Commit `.meshenv.example`; keep `.meshenv` gitignored.

## First Config

```ts
import { defineMeshConfig } from '@panomapp/mesh'

export default defineMeshConfig({
  app: 'my-app',
  router: {
    port: 3000,
    secret: process.env.MESH_SECRET ?? 'dev-only-change-me',
    sessionAffinity: true
  },
  runtime: {
    mode: 'process',
    defaultWatch: true,
    portRange: { from: 3100, to: 3999 }
  },
  services: {
    frontend: {
      type: 'frontend',
      command: 'npm run dev',
      cwd: './frontend',
      route: '/',
      port: 5173
    },
    api: {
      type: 'backend',
      command: 'npm run dev',
      cwd: './backend',
      route: '/api',
      healthPath: '/health',
      instances: 2
    },
    worker: {
      type: 'worker',
      command: 'npm run worker',
      cwd: './backend',
      watch: false
    }
  }
})
```

## Running It

Start the full system:

```bash
mesh run --all
```

Start a single service:

```bash
mesh run api
```

Temporarily scale one service:

```bash
mesh run api --instances 4
```

## What Happens

- Mesh router listens on the public port
- Frontend and API run on their own ports
- Router sends `/` requests to the frontend
- Router sends `/api` requests to the backend
- Worker runs in the background and does not receive public traffic

## Useful Commands

```bash
mesh ps
mesh watch api
mesh stop
mesh dashboard
mesh stream
```

## First-Setup Checklist

- Give every backend service a `healthPath`
- Do not leave the router `secret` empty, even in development
- Design `route` ownership deliberately
- Do not give workers public routes

## Next Step

[03 Router And Routing](./03-router-and-routing.md)
