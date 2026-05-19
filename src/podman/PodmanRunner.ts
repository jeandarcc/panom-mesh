import { spawn } from 'node:child_process'

export interface PodmanRunResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export class PodmanRunner {
  public constructor(private readonly podmanPath: string) {}

  public async run(args: readonly string[], options: { readonly allowFailure?: boolean } = {}): Promise<PodmanRunResult> {
    const result = await new Promise<PodmanRunResult>((resolve, reject) => {
      const child = spawn(this.podmanPath, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', chunk => { stdout += chunk.toString('utf8') })
      child.stderr?.on('data', chunk => { stderr += chunk.toString('utf8') })
      child.once('error', reject)
      child.once('exit', code => resolve({ code: code ?? 0, stdout, stderr }))
    })
    if (!options.allowFailure && result.code !== 0) {
      throw new Error(`podman ${args.join(' ')} failed with code ${result.code}: ${result.stderr || result.stdout}`.trim())
    }
    return result
  }
}
