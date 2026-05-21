import process from 'node:process'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createInterface } from 'node:readline/promises'
import type { NormalizedMeshServiceConfig } from '../core/types.js'
import { SimpleRedisClient } from '../registry/redis/SimpleRedisClient.js'
import { sleep } from '../utils/time.js'

const execFileAsync = promisify(execFile)
const REDIS_CONNECT_RETRY_COUNT = 5
const REDIS_CONNECT_RETRY_DELAY_MS = 1_500

export interface ProcessRedisPreflightServicePlan {
  readonly service: NormalizedMeshServiceConfig
  readonly count: number
}

interface RedisRequirement {
  readonly serviceName: string
  readonly requestedCount: number
  readonly redisUrl: string
}

interface EffectiveServiceEnv {
  readonly realtimeEnabled: boolean
  readonly redisUrl: string
}

export class ProcessRedisPreflight {
  public async prepare(servicePlans: readonly ProcessRedisPreflightServicePlan[]): Promise<readonly ProcessRedisPreflightServicePlan[]> {
    const requirements = this.collectRequirements(servicePlans)
    if (requirements.length === 0) return servicePlans

    const redisUrl = requirements[0]!.redisUrl
    if (await this.waitForRedis(redisUrl, false)) return servicePlans

    const installed = await this.tryResolveRedis(requirements, redisUrl)
    if (installed) return servicePlans

    const affected = new Set(requirements.map(requirement => requirement.serviceName))

    return servicePlans.map(plan => {
      if (!affected.has(plan.service.name)) return plan
      return {
        service: {
          ...plan.service,
          env: {
            ...plan.service.env,
            PANOM_API_INSTANCES: '1',
          },
        },
        count: 1,
      }
    })
  }

  private collectRequirements(servicePlans: readonly ProcessRedisPreflightServicePlan[]): readonly RedisRequirement[] {
    return servicePlans.flatMap(plan => {
      if (plan.service.type !== 'backend') return []
      if (plan.count <= 1) return []
      const effectiveEnv = this.resolveEffectiveEnv(plan.service)
      if (!effectiveEnv.realtimeEnabled) return []

      return [{
        serviceName: plan.service.name,
        requestedCount: plan.count,
        redisUrl: effectiveEnv.redisUrl,
      }]
    })
  }

  private resolveEffectiveEnv(service: NormalizedMeshServiceConfig): EffectiveServiceEnv {
    const dotenvEnv = this.readDotenv(service.cwd)
    const realtimeEnabled = (
      service.env.REALTIME_ENABLED ??
      process.env.REALTIME_ENABLED ??
      dotenvEnv.REALTIME_ENABLED ??
      'false'
    ) === 'true'

    const redisUrl =
      service.env.REALTIME_REDIS_URL ||
      process.env.REALTIME_REDIS_URL ||
      dotenvEnv.REALTIME_REDIS_URL ||
      service.env.REDIS_URL ||
      process.env.REDIS_URL ||
      dotenvEnv.REDIS_URL ||
      'redis://127.0.0.1:6379'

    return {
      realtimeEnabled,
      redisUrl,
    }
  }

  private readDotenv(cwd: string): Record<string, string> {
    const envPath = path.join(cwd, '.env')
    if (!fs.existsSync(envPath)) return {}

    const content = fs.readFileSync(envPath, 'utf8')
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

  private async isRedisReachable(redisUrl: string): Promise<boolean> {
    try {
      const reply = await new SimpleRedisClient({ url: redisUrl, connectTimeoutMs: 1_500 }).command(['PING'])
      return reply === 'PONG'
    } catch {
      return false
    }
  }

  private async waitForRedis(redisUrl: string, verbose: boolean): Promise<boolean> {
    for (let attempt = 1; attempt <= REDIS_CONNECT_RETRY_COUNT; attempt += 1) {
      if (verbose) {
        process.stdout.write(`[mesh] Trying to connect Redis ${attempt}/${REDIS_CONNECT_RETRY_COUNT} at ${redisUrl}...\n`)
      }

      if (await this.isRedisReachable(redisUrl)) return true
      if (attempt < REDIS_CONNECT_RETRY_COUNT) await sleep(REDIS_CONNECT_RETRY_DELAY_MS)
    }

    return false
  }

  private async tryResolveRedis(requirements: readonly RedisRequirement[], redisUrl: string): Promise<boolean> {
    const summary = requirements.map(requirement => `${requirement.serviceName} x${requirement.requestedCount}`).join(', ')
    const fallbackSummary = requirements.map(requirement => `${requirement.serviceName}=1`).join(', ')

    process.stdout.write(
      `[mesh] Realtime multi-instance mode requires Redis, but ${redisUrl} is not reachable.\n` +
      `[mesh] Affected services: ${summary}\n`,
    )

    const shouldInstall = await this.promptForInstall()
    if (!shouldInstall) {
      process.stdout.write(`[mesh] Redis setup skipped. Continuing with safe fallback: ${fallbackSummary}.\n`)
      return false
    }

    const installed = await this.installRedisWithBrew(redisUrl)
    if (!installed) {
      process.stdout.write(`[mesh] Redis setup could not be completed automatically. Continuing with safe fallback: ${fallbackSummary}.\n`)
      return false
    }

    if (await this.waitForRedis(redisUrl, true)) {
      process.stdout.write(`[mesh] Redis is ready at ${redisUrl}. Continuing with requested multi-instance setup.\n`)
      return true
    }

    process.stdout.write(`[mesh] Redis setup ran, but ${redisUrl} is still unreachable. Continuing with safe fallback: ${fallbackSummary}.\n`)
    return false
  }

  private async promptForInstall(): Promise<boolean> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return false

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    try {
      const answer = (await rl.question('[mesh] Redis kurulumunu ve baslatilmasini otomatik halledeyim mi? [Y/n] ')).trim().toLowerCase()
      return answer === '' || answer === 'y' || answer === 'yes' || answer === 'e' || answer === 'evet'
    } finally {
      rl.close()
    }
  }

  private async installRedisWithBrew(redisUrl: string): Promise<boolean> {
    if (process.platform !== 'darwin') {
      process.stdout.write(
        `[mesh] Automatic Redis setup is currently supported on macOS via Homebrew.\n` +
        `[mesh] Please start Redis manually for ${redisUrl} if you want multi-instance local realtime.\n`,
      )
      return false
    }

    try {
      await execFileAsync('brew', ['--version'])
    } catch {
      process.stdout.write('[mesh] Homebrew is not installed, so Redis could not be set up automatically.\n')
      return false
    }

    try {
      try {
        await execFileAsync('brew', ['list', 'redis'])
      } catch {
        process.stdout.write('[mesh] Installing Redis with Homebrew...\n')
        await execFileAsync('brew', ['install', 'redis'], { maxBuffer: 1024 * 1024 * 8 })
      }

      process.stdout.write('[mesh] Starting Redis with Homebrew services...\n')
      await execFileAsync('brew', ['services', 'start', 'redis'], { maxBuffer: 1024 * 1024 * 4 })
      return true
    } catch (error) {
      process.stdout.write(`[mesh] Automatic Redis setup failed: ${error instanceof Error ? error.message : String(error)}\n`)
      return false
    }
  }
}
