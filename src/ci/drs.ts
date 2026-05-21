import fs from 'node:fs'
import path from 'node:path'

export interface DrsPackageEntry {
  readonly to?: readonly string[]
  readonly 'only-source'?: boolean
  readonly prebuilt?: boolean
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
  readonly dependencyNames: readonly string[]
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
  const sourcePackageNames = new Set<string>()

  for (const packageName of consumerEntry.dependencies) {
    const packageEntry = config.packages[packageName]
    if (!packageEntry) {
      throw new Error(`DRS consumer "${consumerEntry.dir}" depends on unknown package "${packageName}".`)
    }

    const absoluteLocalPath = path.resolve(drsRoot, packageEntry.local.path)
    const sourceTargets = packageEntry.to ?? []
    const sourceForConsumer = sourceTargets.length === 0 || sourceTargets.includes(consumerSlug)

    if (!sourceForConsumer) {
      installSpecifiers.push(`${packageName}@${packageEntry.registry.version}`)
      continue
    }

    if (!fs.existsSync(absoluteLocalPath)) {
      throw new Error(
        `DRS package "${packageName}" is marked only-source but local path is missing: ${absoluteLocalPath}.`
      )
    }

    const generatedPath = resolveGeneratedModulePath(packageEntry.local.path)
    sourcePackageNames.add(packageName)
    sourcePackages.push({
      name: packageName,
      sourcePath: path.relative(projectRoot, absoluteLocalPath) || '.',
      generatedPath,
      installSpecifier: `file:./${generatedPath}`,
      // Only include buildCommand when it is explicitly defined to avoid
      // assigning `undefined` to a present property (exactOptionalPropertyTypes).
      ...(packageEntry.local.build !== undefined ? { buildCommand: packageEntry.local.build } : {}),
      dependencyNames: [],
    })
  }

  const sourcePackagesByName = new Map(sourcePackages.map(pkg => [pkg.name, pkg]))
  for (let index = 0; index < sourcePackages.length; index += 1) {
    const sourcePackage = sourcePackages[index]!
    const packageJson = readPackageJson(path.resolve(projectRoot, sourcePackage.sourcePath), sourcePackage.name)
    sourcePackages[index] = {
      ...sourcePackage,
      dependencyNames: listDrsDependencies(packageJson, sourcePackageNames),
    }
  }

  const orderedSourcePackages = sortSourcePackages(sourcePackages)
  const allSpecifiers = [...installSpecifiers, ...orderedSourcePackages.map(pkg => pkg.installSpecifier)]

  return {
    consumerPath: path.relative(projectRoot, normalizedConsumerPath) || '.',
    consumerSlug,
    installSpecifiers: allSpecifiers,
    installCommand: formatNpmInstallCommand(allSpecifiers),
    sourcePackages: orderedSourcePackages,
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

  const generatedPackages = new Map(plan.sourcePackages.map(pkg => [pkg.name, pkg]))
  for (const sourcePackage of plan.sourcePackages) {
    await rewriteGeneratedPackageManifest(path.join(consumerCwd, sourcePackage.generatedPath), generatedPackages)
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

async function rewriteGeneratedPackageManifest(
  generatedPackageDir: string,
  generatedPackages: ReadonlyMap<string, DrsSourcePackagePlan>
): Promise<void> {
  const packageJsonPath = path.join(generatedPackageDir, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Generated DRS package is missing package.json: ${generatedPackageDir}`)
  }

  const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf8')) as PackageJson
  rewriteDependencyBlock(packageJson.dependencies, generatedPackageDir, generatedPackages)
  rewriteDependencyBlock(packageJson.devDependencies, generatedPackageDir, generatedPackages)
  rewriteDependencyBlock(packageJson.peerDependencies, generatedPackageDir, generatedPackages)
  rewriteDependencyBlock(packageJson.optionalDependencies, generatedPackageDir, generatedPackages)

  await fs.promises.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
  await fs.promises.rm(path.join(generatedPackageDir, 'package-lock.json'), { force: true })
}

function rewriteDependencyBlock(
  dependencies: Record<string, string> | undefined,
  generatedPackageDir: string,
  generatedPackages: ReadonlyMap<string, DrsSourcePackagePlan>
): void {
  if (!dependencies) return

  for (const dependencyName of Object.keys(dependencies)) {
    const generatedDependency = generatedPackages.get(dependencyName)
    if (!generatedDependency) continue
    const generatedPath = generatedDependency.generatedPath
    if (!generatedPath) continue
    const consumerRoot = generatedPackageDir.split(`${path.sep}${GENERATED_MODULES_DIR}${path.sep}`)[0]
    const targetDir = path.join(String(consumerRoot), String(generatedPath))
    dependencies[dependencyName] = `file:${path.relative(generatedPackageDir, targetDir) || '.'}`
  }
}

interface PackageJson {
  readonly name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

function readPackageJson(packageDir: string, packageName: string): PackageJson {
  const packageJsonPath = path.join(packageDir, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`DRS package "${packageName}" is missing package.json at ${packageJsonPath}.`)
  }
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJson
}

function listDrsDependencies(packageJson: PackageJson, sourcePackageNames: ReadonlySet<string>): readonly string[] {
  const names = new Set<string>()
  for (const block of [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.optionalDependencies,
  ]) {
    for (const dependencyName of Object.keys(block ?? {})) {
      if (sourcePackageNames.has(dependencyName)) {
        names.add(dependencyName)
      }
    }
  }
  return [...names]
}

function sortSourcePackages(sourcePackages: readonly DrsSourcePackagePlan[]): readonly DrsSourcePackagePlan[] {
  const byName = new Map(sourcePackages.map(pkg => [pkg.name, pkg]))
  const remainingDependencies = new Map<string, Set<string>>()
  const dependents = new Map<string, Set<string>>()

  for (const sourcePackage of sourcePackages) {
    const dependencies = new Set(sourcePackage.dependencyNames.filter(name => byName.has(name)))
    remainingDependencies.set(sourcePackage.name, dependencies)
    for (const dependencyName of dependencies) {
      const nextDependents = dependents.get(dependencyName) ?? new Set<string>()
      nextDependents.add(sourcePackage.name)
      dependents.set(dependencyName, nextDependents)
    }
  }

  const ready = sourcePackages
    .filter(pkg => (remainingDependencies.get(pkg.name)?.size ?? 0) === 0)
    .map(pkg => pkg.name)
  const ordered: DrsSourcePackagePlan[] = []

  while (ready.length > 0) {
    const nextName = ready.shift()!
    ordered.push(byName.get(nextName)!)
    for (const dependentName of dependents.get(nextName) ?? []) {
      const dependencySet = remainingDependencies.get(dependentName)
      if (!dependencySet) continue
      dependencySet.delete(nextName)
      if (dependencySet.size === 0) {
        ready.push(dependentName)
      }
    }
  }

  if (ordered.length !== sourcePackages.length) {
    const unresolved = sourcePackages
      .filter(pkg => !ordered.some(candidate => candidate.name === pkg.name))
      .map(pkg => pkg.name)
      .join(', ')
    throw new Error(`DRS source packages contain a dependency cycle: ${unresolved}`)
  }

  return ordered
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

  if (raw.root !== undefined) {
    return {
      root: raw.root,
      packages: raw.packages as Record<string, DrsPackageEntry>,
      consumers: raw.consumers as Record<string, DrsConsumerEntry>,
    }
  }

  return {
    packages: raw.packages as Record<string, DrsPackageEntry>,
    consumers: raw.consumers as Record<string, DrsConsumerEntry>,
  }
}

export function getDrsPackageEntry(projectRoot: string, packageName: string): DrsPackageEntry {
  const config = loadDrsConfig(projectRoot)
  const entry = config.packages[packageName]
  if (!entry) {
    throw new Error(`DRS package "${packageName}" is not defined in ${path.join(projectRoot, 'drs.config.json')}.`)
  }
  return entry
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
