# Mesh Runtime And Registry

The runtime and registry are the "back mechanics" of Mesh.

## What the Runtime Does

The runtime:

- starts and stops processes
- allocates ports
- manages log files
- controls restart and watch behavior
- coordinates drain flow

### Process Mode

This is the simplest mode for local development.

```ts
runtime: {
  mode: 'process',
  stateDir: '.mesh',
  logsDir: '.mesh/logs',
  defaultWatch: true,
  portRange: { from: 31000, to: 32999 }
}
```

### Podman Mode

Use Podman mode when you need container-based execution.

```ts
runtime: {
  mode: 'podman'
}
```

## What the Registry Is

The registry is the instance ledger.

Each record typically knows:

- service name
- instance id
- host and port
- route metadata
- health and heartbeat status
- start time

## File Registry

This is the default development option.

Advantages:

- no extra dependency
- easy local debugging
- enough for a single machine

## Redis Registry

Prefer this when you need:

- multiple process groups
- Podman
- multiple hosts
- centralized heartbeat and coordination

## Heartbeat and TTL

If an instance is alive, it sends a heartbeat. When the TTL expires, the registry effectively removes that node from routing.

That keeps "process exists but must not receive traffic" scenarios under control.

## Drain

Drain should be thought of in this order:

- stop accepting new traffic
- let active requests and sockets finish
- close after timeout if needed

That behavior matters a lot during rolling restarts and deploys.

## Next Step

[06 Observability And Operations](./06-observability-and-operations.md)
