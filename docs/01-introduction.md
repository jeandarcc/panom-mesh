# Mesh Introduction

`@panomapp/mesh` is an application mesh that runs multiple services and instances behind one gateway model.

## What It Solves

Typical apps need all of this:

- run frontend, API, and worker together
- distribute routes through a single public entrypoint
- start multiple instances of the same backend service
- send traffic only to healthy nodes
- stop new requests during drain
- support flows that need sticky sessions
- keep the same mental model locally with process mode, and later with Podman or Redis

That is exactly what Mesh is for.

## Mental Model

Think of Mesh as four parts:

1. Config
   `mesh.config.ts` describes what the system should look like.
2. Runtime
   Starts, monitors, and stops process or Podman instances.
3. Registry
   Tracks which instances are alive, healthy, draining, or gone.
4. Router
   Sends HTTP and WebSocket traffic to the correct instance.

## Basic Flow

```txt
browser
  -> mesh router
  -> frontend / api / worker ecosystem
```

Workers do not receive public traffic. Frontend and backend services do, based on route ownership.

## Mesh Vocabulary

Some core terms:

- `service`: a logical unit such as `frontend`, `api`, or `worker`
- `instance`: one running copy of a service
- `route`: the URL space owned by a service
- `strategy`: the request distribution method
- `registry`: the live instance inventory
- `drain`: the shutdown phase where active requests are allowed to finish

## Why Separate Mesh?

Because it is more than a process manager:

- health-aware routing
- sticky sessions
- HSM route mapping
- dashboard and stream commands
- distributed locks and leader election
- cleanup scheduling

The goal is not just to "start processes" but to keep the app's live topology in one system.

## Next Step

[02 Quick Start](./02-quick-start.md)
