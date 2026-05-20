import fs from 'node:fs'
import path from 'node:path'

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
  readonly sourcePath: string
  readonly generatedPath: string
  readonly installSpecifier: string
  readonly buildCommand?: string
}

export interface DrsWorkflowPlan {
  readonly consumerPath: string
  readonly consumerSlug: string
  readonly installSpecifiers: readonly string[]
  readonly installCommand: string
  readonly sourcePackages: readonly DrsSourcePackagePlan[]
}

const GENERATED_MODULES_DIR = 'generated_modules'
const COPY_EXCLUDES = new Set(['.git', 'node_modules', 'dist', '.turbo', '.next', '.DS_Store'])

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

    const generatedPath = resolveGeneratedModulePath(packageEntry.local.path)
    sourcePackages.push({
      name: packageName,
      sourcePath: path.relative(projectRoot, absoluteLocalPath) || '.',
      generatedPath,
      installSpecifier: `file:./${generatedPath}`,
      buildCommand: packageEntry.local.build,
    })
  }

  const allSpecifiers = [...installSpecifiers, ...sourcePackages.map(pkg => pkg.installSpecifier)]

  return {
    consumerPath: path.relative(projectRoot, normalizedConsumerPath) || '.',
    consumerSlug,
    installSpecifiers: allSpecifiers,
    installCommand: formatNpmInstallCommand(allSpecifiers),
    sourcePackages,
  }
}

export async function syncDrsGeneratedModules(projectRoot: string, consumerCwd: string): Promise<void> {
  const plan = getDrsWorkflowPlan(projectRoot, consumerCwd)
  const generatedRoot = path.join(consumerCwd, GENERATED_MODULES_DIR)

  await fs.promises.rm(generatedRoot, { recursive: true, force: true })
  await fs.promises.mkdir(generatedRoot, { recursive: true })

  for (const sourcePackage of plan.sourcePackages) {
    const absoluteSourcePath = path.resolve(projectRoot, sourcePackage.sourcePath)
    const absoluteGeneratedPath = path.join(consumerCwd, sourcePackage.generatedPath)
    await fs.promises.mkdir(path.dirname(absoluteGeneratedPath), { recursive: true })
    await fs.promises.cp(absoluteSourcePath, absoluteGeneratedPath, {
      recursive: true,
      filter: source => {
        const entryName = path.basename(source)
        return !COPY_EXCLUDES.has(entryName) && !entryName.startsWith('._')
      },
    })
    await pruneGeneratedNoise(absoluteGeneratedPath)
  }
}

function resolveGeneratedModulePath(localPath: string): string {
  const normalized = localPath.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '')
  if (normalized === '' || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`DRS local.path must stay inside the repository root: ${localPath}`)
  }
  return path.posix.join(GENERATED_MODULES_DIR, normalized)
}

async function pruneGeneratedNoise(dir: string): Promise<void> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const target = path.join(dir, entry.name)
    if (entry.name.startsWith('._') || entry.name === '.DS_Store') {
      await fs.promises.rm(target, { recursive: true, force: true })
      continue
    }
    if (entry.isDirectory()) {
      await pruneGeneratedNoise(target)
    }
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
