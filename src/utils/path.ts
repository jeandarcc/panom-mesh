import path from 'node:path'

export function resolveFrom(base: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(base, value)
}

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/')
}
