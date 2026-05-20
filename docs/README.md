# Mesh Docs

`@panomapp/mesh` documentation is organized as a book with short, readable chapters. The goal is to let someone start with "what does this system do?" and move in a straight line toward advanced topics like TLS, registry, Podman, locks, and leader election.

## Reading Order

1. [01 Introduction](./01-introduction.md)
2. [02 Quick Start](./02-quick-start.md)
3. [03 Router And Routing](./03-router-and-routing.md)
4. [04 HTTPS And Dev Domains](./04-https-and-dev-domains.md)
5. [05 Runtime And Registry](./05-runtime-and-registry.md)
6. [06 Observability And Operations](./06-observability-and-operations.md)
7. [07 Coordination Primitives](./07-coordination-primitives.md)
8. [08 Podman And Quadlet](./08-podman-and-quadlet.md)

## Who It Is For

- Teams setting up Mesh for the first time
- Apps that want to place multiple services behind one entrypoint
- Node.js systems that need sticky sessions, graceful drain, log streaming, and leader election

## What Mesh Is

Short version:

- define the topology in `mesh.config.ts`
- start services with `mesh run`
- let the Mesh router send traffic to healthy instances
- keep track of which instances are alive in the registry
- use the runtime layer for process, Podman, or mixed orchestration

## Next Step

Start with [01 Introduction](./01-introduction.md).
