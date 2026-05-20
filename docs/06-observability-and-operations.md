# Mesh Observability And Operations

Mesh is not just about running services. It also provides visibility and diagnostics.

## Dashboard

```bash
mesh dashboard
```

This command shows instance, health, route, connection, and other status information in the terminal.

One-time render:

```bash
mesh dashboard --once
mesh dashboard --json
```

## Process List

```bash
mesh ps
```

Typically, you want to see:

- which services are alive
- which instance runs on which port
- health status
- process id information

## Log Streaming

```bash
mesh stream
mesh watch api
```

These commands make it easy to follow live service output.

## Router Metrics

The router also tracks internal metrics:

- total requests
- proxied requests
- no-target requests
- errors
- number of upgrades
- active HTTP connections
- active socket connections

These metrics are very useful for capacity planning and bug diagnosis.

## Operational Events

Watch these events carefully:

- repeated restarts
- health flapping
- rising no-target count
- drain stuck in progress
- WebSocket upgrade failures

## Troubleshooting Approach

When something breaks, usually follow this order:

1. `mesh ps`
2. `mesh dashboard --once`
3. service logs
4. router logs
5. registry health and heartbeat checks

## Next Step

[07 Coordination Primitives](./07-coordination-primitives.md)
