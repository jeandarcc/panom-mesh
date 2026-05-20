import fs from 'node:fs'
import path from 'node:path'
import type { NormalizedMeshConfig } from '../core/types.js'
import { MeshConfigError } from '../core/errors.js'
import { ensureDir } from '../utils/fs.js'

export interface MeshLaunchdGenerateOptions {
  readonly outputDir?: string
  readonly label?: string
  readonly force?: boolean
  readonly print?: boolean
}

interface LaunchdArtifact {
  readonly name: string
  readonly content: string
  readonly mode?: number
}

export class LaunchdCommand {
  public constructor(private readonly config: NormalizedMeshConfig) {}

  public async generate(options: MeshLaunchdGenerateOptions = {}): Promise<string> {
    if (process.platform !== 'darwin') {
      throw new MeshConfigError('mesh launchd:generate is only available on macOS.')
    }
    if (!this.config.router.tls.enabled || !this.config.router.tls.certPath || !this.config.router.tls.keyPath) {
      throw new MeshConfigError('mesh launchd:generate requires router.tls.enabled with router.tls.certPath and router.tls.keyPath configured.')
    }

    const outputDir = path.resolve(this.config.projectRoot, options.outputDir ?? '.mesh/launchd')
    const label = options.label?.trim() || this.defaultLabel()
    const artifacts = this.buildArtifacts(outputDir, label)

    await ensureDir(outputDir)
    for (const artifact of artifacts) {
      const target = path.join(outputDir, artifact.name)
      if (!options.force && fs.existsSync(target)) {
        throw new MeshConfigError(`Launchd artifact already exists: ${target}. Use --force to overwrite.`)
      }
      await fs.promises.writeFile(target, artifact.content, 'utf8')
      if (artifact.mode !== undefined) await fs.promises.chmod(target, artifact.mode)
    }

    const lines = [
      `Generated ${artifacts.length} macOS launchd file(s) in ${outputDir}.`,
      `Label: ${label}`,
      'Install:',
      `  sudo "${path.join(outputDir, 'install-router-443.sh')}"`,
      'Uninstall:',
      `  sudo "${path.join(outputDir, 'uninstall-router-443.sh')}"`
    ]
    if (options.print) {
      lines.push('', ...artifacts.flatMap((artifact) => [`# ${artifact.name}`, artifact.content.trim(), '']))
    }
    return `${lines.join('\n')}\n`
  }

  private buildArtifacts(outputDir: string, label: string): readonly LaunchdArtifact[] {
    const plistName = `${label}.plist`
    const plistPath = path.join(outputDir, plistName)
    const proxyScriptPath = path.join(outputDir, 'run-router-443.js')
    const launchctlId = `system/${label}`
    const plistDestination = `/Library/LaunchDaemons/${plistName}`
    const supportDir = `/Library/Application Support/PanomMesh/${label}`
    const proxyScriptDestination = `${supportDir}/run-router-443.js`
    const certDestination = `${supportDir}/dev-cert.pem`
    const keyDestination = `${supportDir}/dev-key.pem`
    const logsDir = `/Library/Logs/PanomMesh/${label}`
    const stdoutPath = `${logsDir}/router-443.stdout.log`
    const stderrPath = `${logsDir}/router-443.stderr.log`
    const upstreamHost = '127.0.0.1'
    const upstreamPort = this.config.router.port

    return [
      {
        name: plistName,
        content: this.launchdPlist({
          label,
          nodePath: process.execPath,
          proxyScriptPath: proxyScriptDestination,
          workingDirectory: supportDir,
          stdoutPath,
          stderrPath
        })
      },
      {
        name: 'run-router-443.js',
        mode: 0o755,
        content: this.edgeProxyScript({
          certPath: certDestination,
          keyPath: keyDestination,
          upstreamHost,
          upstreamPort,
          publicHost: this.config.router.host
        })
      },
      {
        name: 'install-router-443.sh',
        mode: 0o755,
        content: [
          '#!/bin/zsh',
          'set -euo pipefail',
          '',
          `install -d -m 755 ${this.shellQuote(supportDir)}`,
          `install -d -m 755 ${this.shellQuote(logsDir)}`,
          `install -m 755 ${this.shellQuote(proxyScriptPath)} ${this.shellQuote(proxyScriptDestination)}`,
          `install -m 644 ${this.shellQuote(this.config.router.tls.certPath!)} ${this.shellQuote(certDestination)}`,
          `install -m 600 ${this.shellQuote(this.config.router.tls.keyPath!)} ${this.shellQuote(keyDestination)}`,
          `install -m 644 ${this.shellQuote(plistPath)} ${this.shellQuote(plistDestination)}`,
          `launchctl bootout ${this.shellQuote(launchctlId)} >/dev/null 2>&1 || true`,
          `launchctl bootstrap system ${this.shellQuote(plistDestination)}`,
          `launchctl enable ${this.shellQuote(launchctlId)}`,
          `launchctl kickstart -k ${this.shellQuote(launchctlId)}`,
          `echo "launchd router installed: ${label}"`
        ].join('\n') + '\n'
      },
      {
        name: 'uninstall-router-443.sh',
        mode: 0o755,
        content: [
          '#!/bin/zsh',
          'set -euo pipefail',
          '',
          `launchctl bootout ${this.shellQuote(launchctlId)} >/dev/null 2>&1 || true`,
          `rm -f ${this.shellQuote(plistDestination)}`,
          `rm -f ${this.shellQuote(proxyScriptDestination)}`,
          `rm -f ${this.shellQuote(certDestination)}`,
          `rm -f ${this.shellQuote(keyDestination)}`,
          `echo "launchd router removed: ${label}"`
        ].join('\n') + '\n'
      }
    ]
  }

  private launchdPlist(options: {
    readonly label: string
    readonly nodePath: string
    readonly proxyScriptPath: string
    readonly workingDirectory: string
    readonly stdoutPath: string
    readonly stderrPath: string
  }): string {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      '  <key>Label</key>',
      `  <string>${this.escapeXml(options.label)}</string>`,
      '  <key>ProgramArguments</key>',
      '  <array>',
      `    <string>${this.escapeXml(options.nodePath)}</string>`,
      `    <string>${this.escapeXml(options.proxyScriptPath)}</string>`,
      '  </array>',
      '  <key>WorkingDirectory</key>',
      `  <string>${this.escapeXml(options.workingDirectory)}</string>`,
      '  <key>RunAtLoad</key>',
      '  <true/>',
      '  <key>KeepAlive</key>',
      '  <true/>',
      '  <key>StandardOutPath</key>',
      `  <string>${this.escapeXml(options.stdoutPath)}</string>`,
      '  <key>StandardErrorPath</key>',
      `  <string>${this.escapeXml(options.stderrPath)}</string>`,
      '</dict>',
      '</plist>',
      ''
    ].join('\n')
  }

  private edgeProxyScript(options: {
    readonly certPath: string
    readonly keyPath: string
    readonly upstreamHost: string
    readonly upstreamPort: number
    readonly publicHost: string
  }): string {
    return `#!/usr/bin/env node
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const tls = require('node:tls')

const cert = fs.readFileSync(${JSON.stringify(options.certPath)})
const key = fs.readFileSync(${JSON.stringify(options.keyPath)})
const upstreamHost = ${JSON.stringify(options.upstreamHost)}
const upstreamPort = ${JSON.stringify(options.upstreamPort)}
const publicHost = ${JSON.stringify(options.publicHost)}

function forwardedFor(req) {
  const current = req.headers['x-forwarded-for']
  const remote = req.socket.remoteAddress || ''
  if (!current) return remote
  return Array.isArray(current) ? current.concat(remote).join(', ') : \`\${current}, \${remote}\`
}

const server = https.createServer({ cert, key }, (req, res) => {
  const proxyReq = https.request({
    host: upstreamHost,
    port: upstreamPort,
    method: req.method,
    path: req.url,
    rejectUnauthorized: false,
    headers: {
      ...req.headers,
      host: req.headers.host || publicHost,
      'x-forwarded-proto': 'https',
      'x-forwarded-host': req.headers.host || publicHost,
      'x-forwarded-for': forwardedFor(req)
    }
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.statusMessage, proxyRes.headers)
    proxyRes.pipe(res)
  })

  proxyReq.on('error', (error) => {
    res.statusCode = 502
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'edge_proxy_error', message: error.message }) + '\\n')
  })

  req.pipe(proxyReq)
})

server.on('upgrade', (req, socket, head) => {
  const target = tls.connect({
    host: upstreamHost,
    port: upstreamPort,
    rejectUnauthorized: false
  }, () => {
    target.write(\`\${req.method || 'GET'} \${req.url || '/'} HTTP/\${req.httpVersion}\\r\\n\`)
    for (const [key, value] of Object.entries({
      ...req.headers,
      host: req.headers.host || publicHost,
      'x-forwarded-proto': 'https',
      'x-forwarded-host': req.headers.host || publicHost,
      'x-forwarded-for': forwardedFor(req)
    })) {
      if (Array.isArray(value)) {
        for (const item of value) target.write(\`\${key}: \${item}\\r\\n\`)
      } else if (value !== undefined) {
        target.write(\`\${key}: \${value}\\r\\n\`)
      }
    }
    target.write('\\r\\n')
    if (head.length) target.write(head)
    socket.pipe(target)
    target.pipe(socket)
  })

  const destroyBoth = () => {
    socket.destroy()
    target.destroy()
  }
  target.on('error', destroyBoth)
  socket.on('error', destroyBoth)
})

server.listen(443, '0.0.0.0')
`
  }

  private defaultLabel(): string {
    const slug = this.config.app.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'mesh'
    return `app.panom.${slug}-router-443`
  }

  private shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`
  }

  private escapeXml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;')
  }
}
