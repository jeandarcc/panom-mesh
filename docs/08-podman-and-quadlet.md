# Mesh Podman And Quadlet

This final chapter takes Mesh beyond process mode.

## Why Podman?

It is useful when you want to:

- make local topology look more like deployment topology
- isolate services at the container level
- package Redis, app, and worker in a more portable way

## Podman Runtime

```ts
runtime: {
  mode: 'podman',
  podman: {
    network: 'my-mesh',
    containerPrefix: 'myapp',
    publishHost: '0.0.0.0',
    replace: true,
    pull: 'always'
  }
}
```

## Service Image Model

```ts
services: {
  api: {
    type: 'backend',
    route: '/api',
    podman: {
      image: 'ghcr.io/my-org/my-api:latest',
      containerPort: 3001
    }
  }
}
```

## Quadlet

Mesh can generate Quadlet output. That lets you start Podman services in a more system-oriented way.

## Config Mount

When using Quadlet or Podman, the config and runtime bundle mount must be designed carefully. The goal stays the same:

- the router must know the right targets
- the registry must be reachable
- the health endpoints must work

## Recommendation

Start in process mode first.
Then:

1. add a Redis registry
2. move to Podman mode
3. generate Quadlet if needed

That is usually the least surprising path.

## Book End

Return to the entry page in [Mesh Docs](./README.md).
