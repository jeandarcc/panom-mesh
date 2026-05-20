import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

interface DrsPackageEntry {
  readonly to?: readonly string[]
  readonly 'only-source'?: boolean
  readonly local: {
    readonly path: string
    readonly build?: string
  }
  readonly registry: {
    readonly version: string
  }
}

interface DrsConsumerEntry {
  readonly dir: string
  readonly dependencies: readonly string[]
}

interface DrsConfigFile {
  readonly root?: string
  readonly packages: Record<string, DrsPackageEntry>
  readonly consumers: Record<string, DrsConsumerEntry>
}

export interface DrsSourcePackagePlan {
  readonly name: string
  readonly localPath: string
  readonly installSpecifier: string
  readonly checkoutRepository: string
  readonly buildCommand?: string
}

export interface DrsWorkflowPlan {
  readonly consumerPath: string
  readonly consumerSlug: string
  readonly installSpecifiers: readonly string[]
  readonly installCommand: string
  readonly sourcePackages: readonly DrsSourcePackagePlan[]
}

export function formatNpmInstallCommand(specifiers: readonly string[]): string {
  return specifiers.length > 0 ? `npm install ${specifiers.join(' ')}` : 'npm install'
}

export function getDrsWorkflowPlan(projectRoot: string, consumerCwd: string): DrsWorkflowPlan {
  const config = loadDrsConfig(projectRoot)
  const drsRoot = path.resolve(projectRoot, config.root ?? '.')
  const normalizedConsumerPath = path.resolve(consumerCwd)
  const consumerEntry = findConsumerEntry(config, drsRoot, normalizedConsumerPath)
  const consumerSlug = path.relative(projectRoot, normalizedConsumerPath) || '.'

  const installSpecifiers: string[] = []
  const sourcePackages: DrsSourcePackagePlan[] = []

  for (const packageName of consumerEntry.dependencies) {
    const packageEntry = config.packages[packageName]
    if (!packageEntry) {
      throw new Error(`DRS consumer "${consumerEntry.dir}" depends on unknown package "${packageName}".`)
    }

    const absoluteLocalPath = path.resolve(drsRoot, packageEntry.local.path)
    const isOnlySource = packageEntry['only-source'] === true
    const sourceTargets = packageEntry.to ?? []
    const sourceForConsumer = sourceTargets.length === 0 || sourceTargets.includes(consumerSlug)

    if (!isOnlySource || !sourceForConsumer) {
      installSpecifiers.push(`${packageName}@${packageEntry.registry.version}`)
      continue
    }

    if (!fs.existsSync(absoluteLocalPath)) {
      throw new Error(
        `DRS package "${packageName}" is marked only-source but local path is missing: ${absoluteLocalPath}.`
      )
    }

    const remoteUrl = readGitRemoteUrl(absoluteLocalPath)
    const repository = parseGitHubRepository(remoteUrl)
    const checkoutPath = path.relative(projectRoot, absoluteLocalPath) || '.'
    const installSpecifier = `file:${path.relative(normalizedConsumerPath, absoluteLocalPath) || '.'}`

    sourcePackages.push({
      name: packageName,
      localPath: checkoutPath,
      installSpecifier,
      checkoutRepository: repository,
      buildCommand: packageEntry.local.build,
    })
  }

  const allSpecifiers = [
    ...installSpecifiers,
    ...sourcePackages.map(pkg => pkg.installSpecifier),
  ]

  return {
    consumerPath: path.relative(projectRoot, normalizedConsumerPath) || '.',
    consumerSlug,
    installSpecifiers: allSpecifiers,
    installCommand: formatNpmInstallCommand(allSpecifiers),
    sourcePackages,
  }
}

function loadDrsConfig(projectRoot: string): DrsConfigFile {
  const configPath = path.join(projectRoot, 'drs.config.json')
  if (!fs.existsSync(configPath)) {
    throw new Error(`DRS config not found at ${configPath}.`)
  }

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<DrsConfigFile>
  if (!raw.packages || typeof raw.packages !== 'object') {
    throw new Error(`DRS config at ${configPath} must define packages.`)
  }
  if (!raw.consumers || typeof raw.consumers !== 'object') {
    throw new Error(`DRS config at ${configPath} must define consumers.`)
  }

  return {
    root: raw.root,
    packages: raw.packages as Record<string, DrsPackageEntry>,
    consumers: raw.consumers as Record<string, DrsConsumerEntry>,
  }
}

function findConsumerEntry(
  config: DrsConfigFile,
  drsRoot: string,
  consumerCwd: string
): DrsConsumerEntry {
  for (const consumer of Object.values(config.consumers)) {
    const consumerPath = path.resolve(drsRoot, consumer.dir)
    if (consumerPath === consumerCwd) {
      return consumer
    }
  }

  throw new Error(`No DRS consumer matches frontend directory: ${consumerCwd}.`)
}

function readGitRemoteUrl(repoDir: string): string {
  try {
    return execFileSync('git', ['-C', repoDir, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
    }).trim()
  } catch (error) {
    throw new Error(`Unable to read git origin for only-source package at ${repoDir}.`)
  }
}

function parseGitHubRepository(remoteUrl: string): string {
  const patterns = [
    /github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/,
    /github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/,
  ]

  for (const pattern of patterns) {
    const match = remoteUrl.match(pattern)
    if (match?.groups?.owner && match.groups.repo) {
      return `${match.groups.owner}/${match.groups.repo}`
    }
  }

  throw new Error(`Cannot derive a GitHub repository slug from remote URL: ${remoteUrl}`)
}
