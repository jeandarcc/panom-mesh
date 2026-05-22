import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyMeshenv, resetMeshenvCache } from '../src/config/meshEnv.js'
import { MeshConfigLoader } from '../src/config/MeshConfigLoader.js'
import { parseEnvFile, readEnvFile, resolveMeshenvPath } from '../src/utils/envFile.js'

describe('envFile', () => {
  it('parses key=value pairs with comments and quoted values', () => {
    expect(parseEnvFile(`
      # comment
      APP_URL=https://dev.panom.app:3000
      AUTH_COOKIE_DOMAIN=".panom.app"
    `)).toEqual({
      APP_URL: 'https://dev.panom.app:3000',
      AUTH_COOKIE_DOMAIN: '.panom.app',
    })
  })

  it('reads .meshenv from disk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-env-'))
    const filePath = path.join(dir, '.meshenv')
    fs.writeFileSync(filePath, 'APP_URL=https://example.test\n', 'utf8')

    expect(readEnvFile(filePath)).toEqual({ APP_URL: 'https://example.test' })
    expect(resolveMeshenvPath(dir)).toBe(filePath)
  })
})

describe('meshEnv', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    resetMeshenvCache()
  })

  it('applies .meshenv values to process.env before config load', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-meshenv-'))
    fs.writeFileSync(path.join(dir, 'mesh.config.ts'), `export default { app: 'test', services: { api: { command: 'node -v', route: '/api' } } }`, 'utf8')
    fs.writeFileSync(path.join(dir, '.meshenv'), 'APP_URL=https://meshenv.test\nCORS_ALLOWED_ORIGINS=https://meshenv.test\n', 'utf8')

    delete process.env.APP_URL
    delete process.env.CORS_ALLOWED_ORIGINS

    const applied = applyMeshenv(dir)
    expect(applied.APP_URL).toBe('https://meshenv.test')
    expect(process.env.APP_URL).toBe('https://meshenv.test')

    await new MeshConfigLoader().load(undefined, dir)
    expect(process.env.CORS_ALLOWED_ORIGINS).toBe('https://meshenv.test')
  })
})
