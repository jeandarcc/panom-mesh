# Mesh HTTPS And Dev Domains

This chapter explains Mesh's browser-facing HTTPS development model.

## Why HTTPS?

Modern browser features and OAuth providers often require:

- a secure origin
- the correct host
- sometimes a public TLD
- `wss` for WebSockets

That is why Mesh can provide a native HTTPS entrypoint instead of being only an HTTP dev server.

## TLS Config

```ts
router: {
  host: 'dev.my-app.com',
  port: 3000,
  secret: process.env.MESH_SECRET ?? 'dev-only-change-me',
  tls: {
    enabled: true,
    certPath: '.mesh/certs/dev.my-app.com.pem',
    keyPath: '.mesh/certs/dev.my-app.com-key.pem',
    minVersion: 'TLSv1.2',
    additionalPorts: [443]
  }
}
```

## Certificate Generation

```bash
mesh cert:init
```

Expected flow:

- choose the host name
- generate a local certificate
- write it under `.mesh/certs/`
- use a local CA trusted by the browser

## Host Standard

In local development, the goal is for the browser to see the app under the correct origin.

That usually means three things:

- a `hosts` entry
- a trusted cert
- a Mesh router TLS listener

## x-forwarded-proto

When TLS is enabled, Mesh forwards `x-forwarded-proto` as `https` based on the actual connection. That matters because the backend may use it for URLs, callbacks, and secure cookie decisions.

## 443 and the Fallback Port

There are two models:

1. `443` as the privileged port
2. a fallback port under the developer session, such as `3000`

On systems like macOS, `443` may not always be available to the same process. In that case:

- the main Mesh router can stay on `3000`
- `443` can be a root-owned edge layer that forwards into Mesh

In that model, Mesh remains central; only the privileged port layer is separated.

## HMR and HTTPS

Dev servers like Vite can fall back to direct HMR websocket connections behind a reverse proxy. When working with Mesh:

- the browser's `wss` connection should go through Mesh
- direct-port fallback should be disabled
- the router must forward WebSocket upgrade headers upstream

## Next Step

[05 Runtime And Registry](./05-runtime-and-registry.md)
