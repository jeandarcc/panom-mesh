import { spawn } from 'node:child_process'
import type { NormalizedMeshConfig, NormalizedMeshTestConfig } from '../core/types.js'

export interface MeshTestCommandOptions {
  readonly service?: string | undefined
  readonly json?: boolean
}

interface TestRunResult {
  readonly name: string
  readonly command: string
  readonly cwd: string
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly durationMs: number
}

export class TestCommand {
  public constructor(private readonly config: NormalizedMeshConfig) {}

  public async run(options: MeshTestCommandOptions = {}): Promise<string> {
    const tests = this.selectTests(options.service)
    const results: TestRunResult[] = []

    for (const test of tests) {
      const started = Date.now()
      if (!options.json) {
        process.stdout.write(`[mesh:test] ${test.name} -> ${test.command}\n`)
      }
      const result = await this.runTest(test)
      results.push({
        name: test.name,
        command: test.command,
        cwd: test.cwd,
        code: result.code,
        signal: result.signal,
        durationMs: Date.now() - started
      })
      if (result.code !== 0) break
    }

    const ok = results.every(result => result.code === 0)
    if (options.json) {
      return `${JSON.stringify({ ok, results }, null, 2)}\n`
    }

    const lines = [ok ? 'Mesh test suite passed.' : 'Mesh test suite failed.']
    for (const result of results) {
      lines.push(`- ${result.name}: ${result.code === 0 ? 'ok' : `failed (exit ${result.code ?? 'signal'})`} in ${result.durationMs}ms`)
    }
    return `${lines.join('\n')}\n`
  }

  private selectTests(service?: string): readonly NormalizedMeshTestConfig[] {
    const tests = Array.from(this.config.tests.values())
    if (!service) return tests
    return tests.filter(test => test.name === service)
  }

  private runTest(test: NormalizedMeshTestConfig): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return new Promise((resolve, reject) => {
      const child = spawn(test.command, {
        cwd: test.cwd,
        env: { ...process.env, ...test.env },
        shell: true,
        stdio: 'inherit'
      })

      child.once('error', reject)
      child.once('exit', (code, signal) => resolve({ code, signal }))
    })
  }
}