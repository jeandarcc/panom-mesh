import { describe, expect, it } from 'vitest'
import { flagNumber, parseArgs } from '../src/cli/args.js'

describe('parseArgs', () => {
  it('parses flags and positionals', () => {
    const parsed = parseArgs(['run', 'api', '--instances', '5', '--all'])
    expect(parsed.command).toBe('run')
    expect(parsed.positionals).toEqual(['api'])
    expect(flagNumber(parsed.flags, 'instances')).toBe(5)
    expect(parsed.flags.get('all')).toBe(true)
  })
})
