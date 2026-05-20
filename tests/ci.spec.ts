import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, afterEach } from 'vitest'
import { CiGenerateCommand } from '../src/ci/CiGenerateCommand.js'
import { MeshConfigNormalizer } from '../src/config/MeshConfigNormalizer.js'
import { defineMeshConfig } from '../src/config/defineMeshConfig.js'

const normalizer = new MeshConfigNormalizer()
const tempDirs: string[] = []

function makeTempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panom-mesh-ci-'))
  tempDirs.push(dir)
  return dir
}

function writeDrsConfig(root: string, consumerDir = 'panom-frontend'): void {
  fs.writeFileSync(
    path.join(root, 'drs.config.json'),
    JSON.stringify({
      version: 1,
      root: '.',
      packages: {
        '@panomapp/hsm-panom-contract': {
          local: { path: 'panom-hsm-contract', build: 'npm run build' },
          registry: { version: '3.0.0' },
        },
        '@panomapp/hsm': {
          local: { path: 'panom-hsm', build: 'npm run build' },
          registry: { version: '^1.0.1' },
        },
        '@panomapp/subdomain-policy': {
          local: { path: 'panom-subdomain', build: 'npm run pack:check' },
          registry: { version: '^0.1.0' },
        },
        '@panomapp/bg-maker': {
          local: { path: 'bg-maker', build: 'npm run build' },
          registry: { version: '^0.1.0' },
        },
      },
      consumers: {
        frontend: {
          dir: consumerDir,
          dependencies: [
            '@panomapp/hsm-panom-contract',
            '@panomapp/hsm',
            '@panomapp/subdomain-policy',
            '@panomapp/bg-maker',
          ],
        },
      },
    }, null, 2),
    'utf8'
  )
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('Mesh CI generation', () => {
  it('uses DRS registry install specs when ci.drs is enabled', async () => {
    const root = makeTempRoot()
    writeDrsConfig(root)

    const config = normalizer.normalize(
      defineMeshConfig({
        app: 'panom',
        ci: {
          drs: {
            enabled: true,
          },
        },
        services: {
          frontend: {
            type: 'frontend',
            command: 'npm run dev',
            cwd: './panom-frontend',
            route: '/',
          },
        },
      }),
      root,
      path.join(root, 'mesh.config.ts')
    )

    const output = await new CiGenerateCommand(config).generate({ print: true })

    expect(output).toContain('Install DRS registry packages')
    expect(output).toContain(
      'npm install @panomapp/hsm-panom-contract@3.0.0 @panomapp/hsm@^1.0.1 @panomapp/subdomain-policy@^0.1.0 @panomapp/bg-maker@^0.1.0'
    )
    expect(output).not.toContain('npm ci')
  })

  it('keeps npm ci when ci.drs is disabled', async () => {
    const root = makeTempRoot()
    writeDrsConfig(root)

    const config = normalizer.normalize(
      defineMeshConfig({
        app: 'panom',
        services: {
          frontend: {
            type: 'frontend',
            command: 'npm run dev',
            cwd: './panom-frontend',
            route: '/',
          },
        },
      }),
      root,
      path.join(root, 'mesh.config.ts')
    )

    const output = await new CiGenerateCommand(config).generate({ print: true })

    expect(output).toContain('Install Dependencies')
    expect(output).toContain('npm ci')
    expect(output).not.toContain('Install DRS registry packages')
  })

  it('throws when no DRS consumer matches the frontend directory', async () => {
    const root = makeTempRoot()
    writeDrsConfig(root, 'panom-not-frontend')

    const config = normalizer.normalize(
      defineMeshConfig({
        app: 'panom',
        ci: {
          drs: {
            enabled: true,
          },
        },
        services: {
          frontend: {
            type: 'frontend',
            command: 'npm run dev',
            cwd: './panom-frontend',
            route: '/',
          },
        },
      }),
      root,
      path.join(root, 'mesh.config.ts')
    )

    await expect(new CiGenerateCommand(config).generate({ print: true })).rejects.toThrow(
      /No DRS consumer matches frontend directory/
    )
  })
})
