import fs from 'node:fs'
import path from 'node:path'

export const MESH_ENV_FILENAME = '.meshenv'

export function parseEnvFile(content: string): Record<string, string> {
  const parsed: Record<string, string> = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) continue

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()
    if (!key) continue

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    parsed[key] = value
  }

  return parsed
}

export function readEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {}
  return parseEnvFile(fs.readFileSync(filePath, 'utf8'))
}

export function resolveMeshenvPath(projectRoot: string): string {
  return path.resolve(projectRoot, MESH_ENV_FILENAME)
}

export function loadMeshenvFile(projectRoot: string): Record<string, string> {
  return readEnvFile(resolveMeshenvPath(projectRoot))
}
