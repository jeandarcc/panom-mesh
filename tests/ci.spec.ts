import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
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

function initGitRepo(dir: string, remoteUrl: string): void {
  fs.mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'Codex'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'codex@example.com'], { cwd: dir })
  execFileSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: dir })
}

function writeDrsConfig(root: string, consumerDir = 'panom-frontend'): void {
  initGitRepo(path.join(root, 'panom-hsm-contract'), 'https://github.com/jeandarcc/Panom.git')
  fs.writeFileSync(
    path.join(root, 'drs.config.json'),
    JSON.stringify({
      version: 1,
      root: '.',
      packages: {
        '@panomapp/hsm-panom-contract': {
          to: ['panom-frontend', 'panom-backend'],
          'only-source': true,
          local: { path: 'panom-hsm-contract', build: 'npm run build' },
          registry: { version: '3.0.0' },
        },
        '@panomapp/hsm': {
          to: ['panom-frontend', 'panom-backend'],
          local: { path: 'panom-hsm', build: 'npm run build' },
          registry: { version: '^1.0.1' },
        },
        '@panomapp/subdomain-policy': {
          to: ['panom-frontend'],
          local: { path: 'panom-subdomain', build: 'npm run pack:check' },
          registry: { version: '^0.1.0' },
        },
        '@panomapp/bg-maker': {
          to: ['panom-frontend'],
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
        backend: {
          dir: 'panom-backend',
          dependencies: ['@panomapp/hsm-panom-contract', '@panomapp/hsm'],
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
  it('uses DRS source and registry install specs when ci.drs is enabled', async () => {
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

    expect(output).toContain('Checkout Frontend')
    expect(output).toContain('repository: jeandarcc/Panom')
    expect(output).toContain('Prepare @panomapp/hsm-panom-contract source')
    expect(output).toContain('working-directory: panom-hsm-contract')
    expect(output).toContain('npm ci')
    expect(output).toContain('npm run build')
    expect(output).toContain('Install DRS dependencies')
    expect(output).toContain(
      'npm install @panomapp/hsm@^1.0.1 @panomapp/subdomain-policy@^0.1.0 @panomapp/bg-maker@^0.1.0 file:../panom-hsm-contract'
    )
    expect(output).not.toContain('@panomapp/hsm-panom-contract@3.0.0')
  })

  it('uses DRS source packages in the backend workflow when ci.drs is enabled', async () => {
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
          api: {
            type: 'backend',
            command: 'npm run dev',
            cwd: './panom-backend',
            route: '/api',
          },
        },
      }),
      root,
      path.join(root, 'mesh.config.ts')
    )

    const output = await new CiGenerateCommand(config).generate({ print: true })

    expect(output).toContain('Checkout Backend')
    expect(output).toContain('path: panom-backend')
    expect(output).toContain('Prepare @panomapp/hsm-panom-contract source')
    expect(output).toContain('working-directory: panom-hsm-contract')
    expect(output).toContain('docker build -t')
    expect(output).toContain('-f panom-backend/Dockerfile .')
    expect(output).not.toContain('@panomapp/hsm-panom-contract@3.0.0')
  })

  it('uses DRS source packages in the backend quadlet workflow when ci.drs is enabled', async () => {
    const root = makeTempRoot()
    writeDrsConfig(root)

    const config = normalizer.normalize(
      defineMeshConfig({
        app: 'panom',
        ci: {
          drs: {
            enabled: true,
          },
          backend: {
            strategy: 'quadlet',
          },
        },
        services: {
          api: {
            type: 'backend',
            command: 'npm run dev',
            cwd: './panom-backend',
            route: '/api',
          },
        },
      }),
      root,
      path.join(root, 'mesh.config.ts')
    )

    const output = await new CiGenerateCommand(config).generate({ print: true })

    expect(output).toContain('Checkout Backend')
    expect(output).toContain('path: panom-backend')
    expect(output).toContain('Install DRS dependencies')
    expect(output).toContain('working-directory: panom-backend')
    expect(output).toContain('Generate Quadlet files')
    expect(output).toContain('rsync -az --delete -e "ssh -p ${DEPLOY_PORT:-22}" panom-backend/.mesh/quadlet/')
    expect(output).not.toContain('@panomapp/hsm-panom-contract@3.0.0')
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
