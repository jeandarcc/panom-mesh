import { loadMeshenvFile } from '../utils/envFile.js'

let cachedMeshenv: Record<string, string> | null = null
let cachedProjectRoot: string | null = null

export function applyMeshenv(projectRoot: string): Record<string, string> {
  const values = loadMeshenvFile(projectRoot)

  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value
  }

  cachedMeshenv = values
  cachedProjectRoot = projectRoot
  return values
}

export function getMeshenv(): Record<string, string> {
  if (cachedProjectRoot) return loadMeshenvFile(cachedProjectRoot)
  return loadMeshenvFile(process.cwd())
}

export function resetMeshenvCache(): void {
  cachedMeshenv = null
  cachedProjectRoot = null
}
