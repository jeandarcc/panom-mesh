import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/index': 'src/cli/index.ts',
    'config/index': 'src/config/index.ts',
    'runtime/index': 'src/runtime/index.ts',
    'router/index': 'src/router/index.ts',
    'registry/index': 'src/registry/index.ts',
    'registry/redis/index': 'src/registry/redis/index.ts',
    'node/index': 'src/node/index.ts',
    'events/index': 'src/events/index.ts',
    'drain/index': 'src/drain/index.ts',
    'podman/index': 'src/podman/index.ts',
    'hsm/index': 'src/hsm/index.ts',
    'observability/index': 'src/observability/index.ts',
    'streaming/index': 'src/streaming/index.ts',
    'locks/index': 'src/locks/index.ts',
    'leader/index': 'src/leader/index.ts',
    'cleanup/index': 'src/cleanup/index.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  target: 'node20',
  shims: false,
  banner: {
    js: ''
  }
})
