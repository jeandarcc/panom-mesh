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
  writeLocalPackage(root, 'panom-subdomain', {
    name: '@panomapp/subdomain-policy',
    version: '0.1.0',
    scripts: {
      'pack:check': 'echo pack',
    },
  })

  writeLocalPackage(root, 'panom-hsm', {
    name: '@panomapp/hsm',
    version: '1.0.1',
    scripts: {
      build: 'echo build',
    },
    dependencies: {
      '@panomapp/subdomain-policy': '^0.1.0',
    },
  })

  writeLocalPackage(root, 'panom-hsm-contract', {
    name: '@panomapp/hsm-panom-contract',
    version: '3.0.0',
    scripts: {
      build: 'echo build',
    },
    dependencies: {
      '@panomapp/hsm': '^1.0.1',
    },
  })

  writeLocalPackage(root, 'bg-maker', {
    name: '@panomapp/bg-maker',
    version: '0.1.0',
    scripts: {
      build: 'echo build',
    },
  })

  writeLocalPackage(root, 'panom-mesh', {
    name: '@panomapp/mesh',
    version: '1.0.0',
    scripts: {
      build: 'echo build',
    },
  })

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

function writeLocalPackage(root: string, localPath: string, packageJson: Record<string, unknown>): void {
  const packageDir = path.join(root, localPath)
  fs.mkdirSync(path.join(packageDir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify(packageJson, null, 2))
  fs.writeFileSync(path.join(packageDir, 'package-lock.json'), JSON.stringify({
    name: packageJson.name,
    lockfileVersion: 3,
  }, null, 2))
  fs.writeFileSync(path.join(packageDir, 'src', 'index.ts'), `export const pkg = '${String(packageJson.name)}'\n`)
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('Mesh CI generation', () => {
  it('uses generated source packages for all DRS dependencies when ci.drs is enabled', async () => {
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

    expect(output).toContain('Prepare @panomapp/hsm-panom-contract source')
    expect(output).toContain('Prepare @panomapp/subdomain-policy source')
    expect(output).toContain('Prepare @panomapp/hsm source')
    expect(output).toContain('Prepare @panomapp/bg-maker source')
    expect(output).toContain('working-directory: generated_modules/panom-hsm-contract')
    expect(output).toContain('working-directory: generated_modules/panom-subdomain')
    expect(output).toContain('working-directory: generated_modules/panom-hsm')
    expect(output).toContain('working-directory: generated_modules/bg-maker')
    expect(output).toContain('npm install')
    expect(output).toContain('Install DRS dependencies')
    expect(output).toContain(
      'npm install file:./generated_modules/panom-subdomain file:./generated_modules/bg-maker file:./generated_modules/panom-hsm file:./generated_modules/panom-hsm-contract'
    )
    expect(output).not.toContain('@panomapp/hsm@^1.0.1')
    expect(output).not.toContain('@panomapp/subdomain-policy@^0.1.0')
    expect(output).not.toContain('@panomapp/bg-maker@^0.1.0')
    expect(output).not.toContain('@panomapp/hsm-panom-contract@3.0.0')
    expect(fs.existsSync(path.join(root, 'panom-frontend', 'generated_modules', 'panom-hsm-contract', 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'panom-frontend', 'generated_modules', 'panom-hsm', 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'panom-frontend', 'generated_modules', 'panom-subdomain', 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'panom-frontend', 'generated_modules', 'bg-maker', 'package.json'))).toBe(true)
    const hsmGeneratedPackage = JSON.parse(fs.readFileSync(
      path.join(root, 'panom-frontend', 'generated_modules', 'panom-hsm', 'package.json'),
      'utf8'
    )) as { dependencies?: Record<string, string> }
    expect(hsmGeneratedPackage.dependencies?.['@panomapp/subdomain-policy']).toBe('file:../panom-subdomain')
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

    expect(output).toContain('Prepare @panomapp/hsm-panom-contract source')
    expect(output).toContain('Prepare @panomapp/hsm source')
    expect(output).toContain('working-directory: generated_modules/panom-hsm-contract')
    expect(output).toContain('working-directory: generated_modules/panom-hsm')
    expect(output).toContain('Install DRS dependencies')
    expect(output).toContain('npm install file:./generated_modules/panom-hsm file:./generated_modules/panom-hsm-contract')
    expect(output).toContain('docker build -t')
    expect(output).toContain('-f Dockerfile .')
    expect(output).not.toContain('@panomapp/hsm@^1.0.1')
    expect(output).not.toContain('@panomapp/hsm-panom-contract@3.0.0')
    expect(fs.existsSync(path.join(root, 'panom-backend', 'generated_modules', 'panom-hsm-contract', 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'panom-backend', 'generated_modules', 'panom-hsm', 'package.json'))).toBe(true)
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

    expect(output).toContain('Install DRS dependencies')
    expect(output).toContain('npm install file:./generated_modules/panom-hsm file:./generated_modules/panom-hsm-contract')
    expect(output).toContain('Generate Quadlet files')
    expect(output).toContain('rsync -az --delete -e "ssh -p ${DEPLOY_PORT:-22}" .mesh/quadlet/')
    expect(output).not.toContain('@panomapp/hsm@^1.0.1')
    expect(output).not.toContain('@panomapp/hsm-panom-contract@3.0.0')
  })

  it('generates a mesh-managed backend workflow and runtime bundle when ci.backend.strategy is mesh', async () => {
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
            strategy: 'mesh',
          },
        },
        runtime: {
          portRange: { from: 31_000, to: 31_999 },
          podman: {
            network: 'panom-mesh',
            containerPrefix: 'panom',
            publishHost: '127.0.0.1',
          },
        },
        router: {
          secret: 'mesh-secret',
        },
        services: {
          api: {
            type: 'backend',
            command: 'npm run dev',
            cwd: './panom-backend',
            route: ['/api', '/socket.io', '/health'],
            strategy: 'session-affinity',
            instances: 2,
            healthPath: '/health',
          },
          worker: {
            type: 'worker',
            command: 'npm run worker',
            cwd: './panom-backend',
            instances: 1,
          },
        },
      }),
      root,
      path.join(root, 'mesh.config.ts')
    )

    const output = await new CiGenerateCommand(config).generate({ print: true })

    expect(output).toContain('Prepare @panomapp/mesh runtime source')
    expect(output).toContain('panom-backend-mesh.service')
    expect(output).toContain('npm run mesh:start')
    expect(output).toContain('Upload backend mesh runtime bundle')
    expect(output).toContain('http://127.0.0.1:8080/health')
    expect(fs.existsSync(path.join(root, 'panom-backend', '.mesh', 'runtime-bundle', 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'panom-backend', '.mesh', 'runtime-bundle', 'mesh.config.cjs'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'panom-backend', '.mesh', 'runtime-bundle', 'generated_modules', 'panom-mesh', 'package.json'))).toBe(true)
    const runtimeConfig = fs.readFileSync(path.join(root, 'panom-backend', '.mesh', 'runtime-bundle', 'mesh.config.cjs'), 'utf8')
    expect(runtimeConfig).toContain("port: 31000")
    expect(runtimeConfig).toContain("instances: 2")
    expect(runtimeConfig).toContain('/socket.io')
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
