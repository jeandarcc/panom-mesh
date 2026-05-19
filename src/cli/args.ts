export interface ParsedArgs {
  readonly command: string
  readonly positionals: readonly string[]
  readonly flags: ReadonlyMap<string, string | boolean>
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command = 'help', ...rest] = argv
  const positionals: string[] = []
  const flags = new Map<string, string | boolean>()

  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index]!
    if (!item.startsWith('--')) {
      positionals.push(item)
      continue
    }

    const withoutPrefix = item.slice(2)
    const eqIndex = withoutPrefix.indexOf('=')
    if (eqIndex >= 0) {
      flags.set(withoutPrefix.slice(0, eqIndex), withoutPrefix.slice(eqIndex + 1))
      continue
    }

    const next = rest[index + 1]
    if (next && !next.startsWith('--')) {
      flags.set(withoutPrefix, next)
      index += 1
    } else {
      flags.set(withoutPrefix, true)
    }
  }

  return { command, positionals, flags }
}

export function flagBoolean(flags: ReadonlyMap<string, string | boolean>, key: string): boolean | undefined {
  const value = flags.get(key)
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value
  return value === 'true' || value === '1'
}

export function flagNumber(flags: ReadonlyMap<string, string | boolean>, key: string): number | undefined {
  const value = flags.get(key)
  if (value === undefined || typeof value === 'boolean') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
