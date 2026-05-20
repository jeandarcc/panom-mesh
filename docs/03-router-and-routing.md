# Mesh Router And Routing

The Mesh router is the system's traffic distributor.

## What the Router Does

- accepts incoming requests
- chooses a service based on the path
- reads the list of healthy instances from the registry
- picks a target instance using the selected strategy
- proxies the request

This applies to both HTTP and WebSocket upgrade requests.

## Route Ownership

Each service can own one or more route areas.

```ts
services: {
  frontend: { route: '/' },
  api: { route: ['/api', '/socket.io', '/health'] }
}
```

The most specific route wins. That lets narrower spaces such as `/api/media` be owned by separate services.

## Healthy Node Selection

The router sends traffic only to healthy instances.

Instance types that are excluded:

- shutting down
- in drain mode
- missed heartbeat
- failed health check

## Distribution Strategies

### round-robin

The simplest distribution strategy. Requests are passed to nodes in order.

### least-connections

Prefers the node with fewer active connections.

### session-affinity

Sticky cookies keep the same client returning to the same node.

This is useful for websocket-heavy flows and stateful backend behavior.

## Sticky Session

The sticky cookie is HMAC-signed. That means users cannot forge a cookie that says "send me to this node."

This cookie:

- is scoped to a service
- contains the node id
- is signed
- is marked `Secure` when needed

## WebSocket Upgrade

Mesh is not only a normal HTTP proxy. For upgrade requests, it forwards:

- `Connection: Upgrade`
- `Upgrade: websocket`
- the related WebSocket headers

to the upstream target.

That matters because HMR, Socket.IO, and real-time flows depend on it.

## Relationship to HSM

Mesh can work with classic path routes or with HSM route mapping. When HSM mapping is used, the bridge between state ownership and service ownership becomes more semantic.

## Next Step

[04 HTTPS And Dev Domains](./04-https-and-dev-domains.md)
