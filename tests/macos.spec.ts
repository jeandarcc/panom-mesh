import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MeshConfigNormalizer } from '../src/config/MeshConfigNormalizer.js'
import { defineMeshConfig } from '../src/config/defineMeshConfig.js'
import { LaunchdCommand } from '../src/macos/LaunchdCommand.js'

function config() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-launchd-'))
  return new MeshConfigNormalizer().normalize(defineMeshConfig({
    app: 'Panom',
    router: {
      host: 'dev.panom.app',
      port: 3000,
      secret: 'secret',
      tls: {
        enabled: true,
        certPath: '.mesh/certs/dev.panom.app.pem',
        keyPath: '.mesh/certs/dev.panom.app-key.pem',
        additionalPorts: [443]
      }
    },
    services: {
      frontend: {
        type: 'frontend',
        command: 'npm run dev',
        route: '/',
        port: 5173
      }
    }
  }), projectRoot, path.join(projectRoot, 'mesh.config.ts'))
}

describe('LaunchdCommand', () => {
  it.skipIf(process.platform !== 'darwin')('generates launchd artifacts for a privileged 443 router', async () => {
    const normalized = config()
    const outDir = path.join(normalized.projectRoot, '.mesh', 'launchd-test')
    const summary = await new LaunchdCommand(normalized).generate({
      outputDir: '.mesh/launchd-test',
      force: true
    })

    expect(summary).toContain('install-router-443.sh')
    const plist = fs.readFileSync(path.join(outDir, 'app.panom.panom-router-443.plist'), 'utf8')
    const proxyScript = fs.readFileSync(path.join(outDir, 'run-router-443.js'), 'utf8')
    const installScript = fs.readFileSync(path.join(outDir, 'install-router-443.sh'), 'utf8')

    expect(plist).toContain('<string>app.panom.panom-router-443</string>')
    expect(plist).toContain('/opt/homebrew/Cellar/node')
    expect(plist).toContain('/Library/Application Support/PanomMesh/app.panom.panom-router-443/run-router-443.js')
    expect(plist).toContain('/Library/Application Support/PanomMesh/app.panom.panom-router-443</string>')
    expect(plist).toContain('/Library/Logs/PanomMesh/app.panom.panom-router-443/router-443.stdout.log')
    expect(proxyScript).toContain("server.listen(443, '0.0.0.0')")
    expect(proxyScript).toContain("const upstreamPort = 3000")
    expect(installScript).toContain('launchctl bootstrap system')
    expect(installScript).toContain('/Library/Application Support/PanomMesh/app.panom.panom-router-443')
    expect(installScript).toContain('dev-cert.pem')
  })
})
