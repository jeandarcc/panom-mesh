import fs from 'node:fs'
import path from 'node:path'
import { ensureDir } from '../utils/fs.js'
import { getDrsWorkflowPlan, syncDrsGeneratedModules } from './drs.js'
import type {
  NormalizedMeshConfig,
  NormalizedMeshServiceConfig,
  MeshCiGenerateOptions,
  NormalizedMeshCiConfig,
} from '../core/types.js'

interface CiArtifact {
  readonly repoDir: string
  readonly name: string
  readonly content: string
}

// Groups services by their resolved cwd so that api+worker (same cwd) produce
// a single backend workflow while frontend (different cwd) gets its own file.
interface ServiceGroup {
  readonly cwd: string
  readonly services: NormalizedMeshServiceConfig[]
}

export class CiGenerateCommand {
  public constructor(private readonly config: NormalizedMeshConfig) {}

  public async generate(options: MeshCiGenerateOptions = {}): Promise<string> {
    const artifacts = this.buildArtifacts(options.service)

    if (this.config.ci.drs.enabled) {
      await this.syncGeneratedModules(options.service)
    }

    if (options.print) {
      return artifacts.map(a => `# ${a.repoDir}/.github/workflows/${a.name}\n${a.content.trim()}\n`).join('\n') + '\n'
    }

    for (const artifact of artifacts) {
      const dir = path.join(artifact.repoDir, '.github', 'workflows')
      await ensureDir(dir)
      const target = path.join(dir, artifact.name)
      await fs.promises.writeFile(target, artifact.content, 'utf8')
    }

    const lines = [`Generated ${artifacts.length} CI workflow file(s):`]
    for (const artifact of artifacts) {
      lines.push(`  ${path.join(artifact.repoDir, '.github', 'workflows', artifact.name)}`)
    }
    return `${lines.join('\n')}\n`
  }

  private async syncGeneratedModules(onlyService?: string): Promise<void> {
    const serviceCwds = new Set<string>()

    for (const group of this.groupByCwd(onlyService)) {
      const hasDeployableService = group.services.some(
        s => s.type === 'frontend' || s.type === 'backend' || s.type === 'worker'
      )
      if (hasDeployableService) {
        serviceCwds.add(group.cwd)
      }
    }

    for (const cwd of serviceCwds) {
      await syncDrsGeneratedModules(this.config.projectRoot, cwd)
    }
  }

  // ─── artifact builder ────────────────────────────────────────────────────

  private buildArtifacts(onlyService?: string): readonly CiArtifact[] {
    const ci = this.config.ci
    const groups = this.groupByCwd(onlyService)
    const artifacts: CiArtifact[] = []

    for (const group of groups) {
      const hasFrontend = group.services.some(s => s.type === 'frontend')
      const hasBackend = group.services.some(s => s.type === 'backend' || s.type === 'worker')

      if (hasFrontend) {
        const frontendSvc = group.services.find(s => s.type === 'frontend')!
        artifacts.push({
          repoDir: group.cwd,
          name: 'deploy.yml',
          content: this.frontendWorkflow(frontendSvc, ci),
        })
      }

      if (hasBackend) {
        const apiSvc = group.services.find(s => s.type === 'backend')
        const workerSvc = group.services.find(s => s.type === 'worker')
        artifacts.push({
          repoDir: group.cwd,
          name: 'deploy.yml',
          content: this.backendWorkflow(apiSvc ?? workerSvc!, workerSvc, ci),
        })
      }
    }

    return artifacts
  }

  private groupByCwd(onlyService?: string): readonly ServiceGroup[] {
    const byDir = new Map<string, NormalizedMeshServiceConfig[]>()

    for (const [name, svc] of this.config.services) {
      if (onlyService && name !== onlyService) continue
      const existing = byDir.get(svc.cwd) ?? []
      existing.push(svc)
      byDir.set(svc.cwd, existing)
    }

    return [...byDir.entries()].map(([cwd, services]) => ({ cwd, services }))
  }

  // ─── Frontend workflow ───────────────────────────────────────────────────

  private frontendWorkflow(svc: NormalizedMeshServiceConfig, ci: NormalizedMeshCiConfig): string {
    return ci.frontend.strategy === 'image'
      ? this.frontendImageWorkflow(svc, ci)
      : this.frontendRsyncWorkflow(svc, ci)
  }

  private frontendDrsPlan(svc: NormalizedMeshServiceConfig) {
    return getDrsWorkflowPlan(this.config.projectRoot, svc.cwd)
  }

  private frontendDrsBootstrapSteps(plan: ReturnType<typeof getDrsWorkflowPlan>): string[] {
    const steps: string[] = []

    for (const sourcePackage of plan.sourcePackages) {
      steps.push(
        '      - name: Prepare ' + sourcePackage.name + ' source',
        '        working-directory: ' + sourcePackage.generatedPath,
        '        run: |',
          '          npm ci',
          '          ' + (sourcePackage.buildCommand ?? 'npm run build'),
        '',
      )
    }

    return steps
  }

  private frontendInstallCommand(ci: NormalizedMeshCiConfig, plan?: ReturnType<typeof getDrsWorkflowPlan>): string {
    if (!ci.drs.enabled || !plan) {
      return 'npm ci'
    }

    return plan.installCommand
  }

  private frontendRsyncWorkflow(svc: NormalizedMeshServiceConfig, ci: NormalizedMeshCiConfig): string {
    const buildArgs = ci.frontend.buildArgs
    const buildEnvLines = buildArgs.map(k => `          ${k}: ${this.ghaSecret(k)}`).join('\n')
    const buildEnvBlock = buildArgs.length > 0 ? '\n' + buildEnvLines : ''
    const plan = ci.drs.enabled ? this.frontendDrsPlan(svc) : undefined
    const installCommand = this.frontendInstallCommand(ci, plan)
    const checkoutStep = [
      '      - name: Checkout',
      '        uses: actions/checkout@v4',
      '',
      ...(ci.drs.enabled ? this.frontendDrsBootstrapSteps(plan!) : []),
    ]
    const setupNodeStep = [
      '      - name: Setup Node',
      '        uses: actions/setup-node@v4',
      '        with:',
      '          node-version: 20',
      '          cache: npm',
      ...(ci.drs.enabled ? ['          cache-dependency-path: package-lock.json'] : []),
      '',
    ]
    const installStepName = ci.drs.enabled ? 'Install DRS dependencies' : 'Install Dependencies'

    return [
      'name: Deploy Frontend',
      '',
      'on:',
      '  push:',
      '    branches:',
      '      - ' + ci.branch,
      '',
      'jobs:',
      '  deploy:',
      '    runs-on: ubuntu-latest',
      '',
      '    steps:',
      ...checkoutStep,
      ...setupNodeStep,
      '      - name: ' + installStepName,
      '        run: |',
      '          ' + installCommand,
      '',
      '      - name: Build Frontend',
      '        env:',
      '          VITE_API_URL: /api' + buildEnvBlock,
      '        run: npm run build',
      '',
      '      - name: Generate nginx config',
      '        run: npm run nginx:generate',
      '',
      '      - name: Setup SSH',
      '        env:',
      '          DEPLOY_SSH_KEY: ' + this.ghaSecret('DEPLOY_SSH_KEY'),
      '          DEPLOY_HOST: ' + this.ghaSecret('DEPLOY_HOST'),
      '          DEPLOY_PORT: ' + this.ghaSecret('DEPLOY_PORT'),
      '        run: |',
      '          mkdir -p ~/.ssh',
      '          echo "$DEPLOY_SSH_KEY" > ~/.ssh/id_rsa',
      '          chmod 600 ~/.ssh/id_rsa',
      '          ssh-keyscan -p "${DEPLOY_PORT:-22}" "$DEPLOY_HOST" >> ~/.ssh/known_hosts',
      '',
      '      - name: Deploy dist to server',
      '        env:',
      '          DEPLOY_HOST: ' + this.ghaSecret('DEPLOY_HOST'),
      '          DEPLOY_USER: ' + this.ghaSecret('DEPLOY_USER'),
      '          DEPLOY_PORT: ' + this.ghaSecret('DEPLOY_PORT'),
      '          DEPLOY_PATH: ' + this.ghaSecret('DEPLOY_PATH'),
      '        run: |',
      '          rsync -az --delete --no-perms --no-times -e "ssh -p ${DEPLOY_PORT:-22}" dist/ "${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}/"',
      '',
      '      - name: Upload nginx config',
      '        env:',
      '          DEPLOY_HOST: ' + this.ghaSecret('DEPLOY_HOST'),
      '          DEPLOY_USER: ' + this.ghaSecret('DEPLOY_USER'),
      '          DEPLOY_PORT: ' + this.ghaSecret('DEPLOY_PORT'),
      '        run: |',
      '          scp -P "${DEPLOY_PORT:-22}" deploy/generated-nginx/panom.conf "${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/panom.conf"',
      '',
      '      - name: Validate and reload nginx',
      '        env:',
      '          DEPLOY_HOST: ' + this.ghaSecret('DEPLOY_HOST'),
      '          DEPLOY_USER: ' + this.ghaSecret('DEPLOY_USER'),
      '          DEPLOY_PORT: ' + this.ghaSecret('DEPLOY_PORT'),
      "        run: |",
      '          ssh -p "${DEPLOY_PORT:-22}" "${DEPLOY_USER}@${DEPLOY_HOST}" <<\'EOF\'',
      '            set -e',
      '            TARGET_NGINX_PATH="/etc/nginx/conf.d/panom.conf"',
      '            if [ -f "${TARGET_NGINX_PATH}" ]; then',
      '              sudo cp "${TARGET_NGINX_PATH}" "${TARGET_NGINX_PATH}.bak"',
      '            fi',
      '            sudo cp /tmp/panom.conf "${TARGET_NGINX_PATH}"',
      '            if sudo nginx -t; then',
      '              sudo systemctl reload nginx',
      '              rm -f /tmp/panom.conf',
      '            else',
      '              if [ -f "${TARGET_NGINX_PATH}.bak" ]; then',
      '                sudo cp "${TARGET_NGINX_PATH}.bak" "${TARGET_NGINX_PATH}"',
      '              fi',
      '              sudo nginx -t',
      '              exit 1',
      '            fi',
      '          EOF',
      '',
    ].join('\n')
  }

  private frontendImageWorkflow(svc: NormalizedMeshServiceConfig, ci: NormalizedMeshCiConfig): string {
    const image = svc.podman.image ?? this.ghaCtx('github.repository_owner') + '/' + this.config.app + '-frontend:latest'
    const buildArgs = ci.frontend.buildArgs
    const buildArgEnvLines = buildArgs.map(k => '          ' + k + ': ' + this.ghaSecret(k)).join('\n')
    const buildArgEnvBlock = buildArgs.length > 0 ? '\n' + buildArgEnvLines : ''
    const buildArgFlagLines = [
      '            --build-arg VITE_API_URL="$VITE_API_URL" \\',
      ...buildArgs.map(k => '            --build-arg ' + k + '="$' + k + '" \\'),
    ].join('\n')
    const plan = ci.drs.enabled ? this.frontendDrsPlan(svc) : undefined
    const installCommand = this.frontendInstallCommand(ci, plan)
    const installStepName = ci.drs.enabled ? 'Install DRS dependencies' : 'Install Dependencies'
    const dockerfilePath = 'Dockerfile'
    const checkoutSteps = [
      '      - name: Checkout',
      '        uses: actions/checkout@v4',
      '',
      ...(ci.drs.enabled ? this.frontendDrsBootstrapSteps(plan!) : []),
    ]
    const setupNodeStep = [
      '      - name: Setup Node',
      '        uses: actions/setup-node@v4',
      '        with:',
      '          node-version: 20',
      '          cache: npm',
      ...(ci.drs.enabled ? ['          cache-dependency-path: package-lock.json'] : []),
      '',
    ]

    return [
      'name: Deploy Frontend',
      '',
      'on:',
      '  push:',
      '    branches:',
      '      - ' + ci.branch,
      '',
      'jobs:',
      '  deploy:',
      '    runs-on: ubuntu-latest',
      '',
      '    permissions:',
      '      contents: read',
      '      packages: write',
      '',
      '    env:',
      '      FRONTEND_IMAGE: ' + image,
      '',
      '    steps:',
      ...checkoutSteps,
      ...setupNodeStep,
      '      - name: ' + installStepName,
      '        run: |',
      '          ' + installCommand,
      '',
      '      - name: Login GHCR',
      '        env:',
      '          GHCR_TOKEN: ' + this.ghaSecret('GITHUB_TOKEN'),
      '          GHCR_USER: ' + this.ghaCtx('github.actor'),
      '        run: |',
      '          for attempt in 1 2 3 4 5; do',
      '            echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin && exit 0',
      '            echo "GHCR login failed, retrying (${attempt}/5)..."',
      '            sleep $((attempt * 2))',
      '          done',
      '          exit 1',
      '',
      '      - name: Build frontend image',
      '        env:',
      '          VITE_API_URL: /api' + buildArgEnvBlock,
      '        run: |',
      '          docker build \\',
      '            -t "$FRONTEND_IMAGE" \\',
      buildArgFlagLines,
      '            -f "' + dockerfilePath + '" .',
      '',
      '      - name: Push frontend image',
      '        run: docker push "$FRONTEND_IMAGE"',
      '',
      '      - name: Setup SSH',
      '        env:',
      '          DEPLOY_SSH_KEY: ' + this.ghaSecret('DEPLOY_SSH_KEY'),
      '          DEPLOY_HOST: ' + this.ghaSecret('DEPLOY_HOST'),
      '          DEPLOY_PORT: ' + this.ghaSecret('DEPLOY_PORT'),
      '        run: |',
      '          mkdir -p ~/.ssh',
      '          echo "$DEPLOY_SSH_KEY" > ~/.ssh/id_rsa',
      '          chmod 600 ~/.ssh/id_rsa',
      '          ssh-keyscan -p "${DEPLOY_PORT:-22}" "$DEPLOY_HOST" >> ~/.ssh/known_hosts',
      '',
      '      - name: Pull and restart frontend on server',
      '        env:',
      '          DEPLOY_HOST: ' + this.ghaSecret('DEPLOY_HOST'),
      '          DEPLOY_USER: ' + this.ghaSecret('DEPLOY_USER'),
      '          DEPLOY_PORT: ' + this.ghaSecret('DEPLOY_PORT'),
      '        run: |',
      '          IMAGE="$FRONTEND_IMAGE"',
      '          ssh -p "${DEPLOY_PORT:-22}" "${DEPLOY_USER}@${DEPLOY_HOST}" "bash -s -- \'$IMAGE\'" <<\'EOF\'',
      '          set -euo pipefail',
      '          IMAGE="$1"',
      '          podman stop panom-frontend >/dev/null 2>&1 || true',
      '          podman rm -f panom-frontend >/dev/null 2>&1 || true',
      '          podman pull "${IMAGE}"',
      '          podman run -d \\',
      '            -p 4173:4173 \\',
      '            --name panom-frontend \\',
      '            "${IMAGE}"',
      '          echo "[deploy] Frontend is UP."',
      '          EOF',
      '',
    ].join('\n')
  }

  // ─── Backend workflow ────────────────────────────────────────────────────

  private backendWorkflow(
    apiSvc: NormalizedMeshServiceConfig,
    workerSvc: NormalizedMeshServiceConfig | undefined,
    ci: NormalizedMeshCiConfig
  ): string {
    return ci.backend.strategy === 'quadlet'
      ? this.backendQuadletWorkflow(apiSvc, workerSvc, ci)
      : this.backendPodmanWorkflow(apiSvc, workerSvc, ci)
  }

  private backendPodmanWorkflow(
    apiSvc: NormalizedMeshServiceConfig,
    workerSvc: NormalizedMeshServiceConfig | undefined,
    ci: NormalizedMeshCiConfig
  ): string {
    const image = apiSvc.podman.image ?? 'ghcr.io/' + this.ghaCtx('github.repository') + ':latest'
    const secrets = ci.backend.envSecrets
    const hasWorker = workerSvc !== undefined
    const plan = ci.drs.enabled ? this.frontendDrsPlan(apiSvc) : undefined
    const backendDockerfilePath = 'Dockerfile'

    const FIXED_KEYS = new Set(['NODE_ENV', 'PORT'])
    const envSecretsLines = secrets.map(k => '          ' + k + ': ' + this.ghaSecret(k)).join('\n')
    const envContentLines = secrets
      .filter(k => !FIXED_KEYS.has(k))
      .map(k => '          ' + k + '=${' + k + '}')
      .join('\n')

    const workerLines = hasWorker ? [
      '          echo "[deploy] Starting worker container..."',
      '          podman stop panom-worker >/dev/null 2>&1 || true',
      '          podman rm -f panom-worker >/dev/null 2>&1 || true',
      '          podman run -d \\',
      '            --env-file ~/.panom.env \\',
      '            -e PANOM_ENABLE_BACKGROUND_JOBS=true \\',
      '            --name panom-worker \\',
      '            "${IMAGE}" node dist/worker.js',
      '          echo "[deploy] Worker container started."',
      '',
    ].join('\n') : ''

    const checkoutSteps = [
      '      - name: Checkout',
      '        uses: actions/checkout@v4',
      '',
      ...(ci.drs.enabled ? this.frontendDrsBootstrapSteps(plan!) : []),
    ]

    const setupNodeStep = [
      '      - name: Setup Node',
      '        uses: actions/setup-node@v4',
      '        with:',
      '          node-version: 20',
      '          cache: npm',
      ...(ci.drs.enabled ? ['          cache-dependency-path: package-lock.json'] : []),
      '',
    ]

    const installStep = ci.drs.enabled
      ? [
        '      - name: Install DRS dependencies',
        '        run: |',
        '          ' + plan!.installCommand,
        '',
      ]
      : []

    return [
      'name: Deploy',
      '',
      'on:',
      '  push:',
      '    branches:',
      '      - ' + ci.branch,
      '',
      '# Prevent multiple deployments from running concurrently and clashing on Podman locks',
      'concurrency:',
      '  group: deploy-backend',
      '  cancel-in-progress: false',
      '',
      'jobs:',
      '  docker:',
      '    runs-on: ubuntu-latest',
      '',
      '    permissions:',
      '      contents: read',
      '      packages: write',
      '',
      '    steps:',
      ...checkoutSteps,
      ...setupNodeStep,
      ...installStep,
      '      - name: Login GHCR',
      '        env:',
      '          GHCR_TOKEN: ' + this.ghaSecret('GITHUB_TOKEN'),
      '          GHCR_USER: ' + this.ghaCtx('github.actor'),
      '        run: |',
      '          for attempt in 1 2 3 4 5; do',
      '            echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin && exit 0',
      '            echo "GHCR login failed, retrying (${attempt}/5)..."',
      '            sleep $((attempt * 2))',
      '          done',
      '          exit 1',
      '',
      '      - name: Build Image',
      '        run: |',
      '          docker build -t ' + image + ' -f ' + backendDockerfilePath + ' .',
      '',
      '      - name: Push Image',
      '        run: |',
      '          docker push ' + image,
      '',
      '      - name: Setup SSH',
      '        env:',
      '          DEPLOY_SSH_KEY: ' + this.ghaSecret('DEPLOY_SSH_KEY'),
      '          DEPLOY_HOST: ' + this.ghaSecret('DEPLOY_HOST'),
      '          DEPLOY_PORT: ' + this.ghaSecret('DEPLOY_PORT'),
      '        run: |',
      '          mkdir -p ~/.ssh',
      '          echo "$DEPLOY_SSH_KEY" > ~/.ssh/id_rsa',
      '          chmod 600 ~/.ssh/id_rsa',
      '          ssh-keyscan -p "${DEPLOY_PORT:-22}" "$DEPLOY_HOST" >> ~/.ssh/known_hosts',
      '',
      '      - name: Write .env on server',
      '        env:',
      '          DEPLOY_HOST: ' + this.ghaSecret('DEPLOY_HOST'),
      '          DEPLOY_USER: ' + this.ghaSecret('DEPLOY_USER'),
      '          DEPLOY_PORT: ' + this.ghaSecret('DEPLOY_PORT'),
      envSecretsLines,
      '        run: |',
      '          # Build .env content locally (never touches disk unencrypted, stays in memory)',
      '          ENV_CONTENT="NODE_ENV=production',
      '          PORT=8080',
      envContentLines + '"',
      '',
      '          # Write .env to server atomically (chmod 600 before writing content)',
      '          ssh -p "${DEPLOY_PORT:-22}" "${DEPLOY_USER}@${DEPLOY_HOST}" \\',
      "            'install -m 600 /dev/null ~/.panom.env'",
      '          printf \'%s\\n\' "$ENV_CONTENT" | \\',
      '            ssh -p "${DEPLOY_PORT:-22}" "${DEPLOY_USER}@${DEPLOY_HOST}" \\',
      "            'cat > ~/.panom.env'",
      '',
      '      - name: Restart Backend on server',
      '        env:',
      '          DEPLOY_HOST: ' + this.ghaSecret('DEPLOY_HOST'),
      '          DEPLOY_USER: ' + this.ghaSecret('DEPLOY_USER'),
      '          DEPLOY_PORT: ' + this.ghaSecret('DEPLOY_PORT'),
      '        run: |',
      '          IMAGE="' + image + '"',
      '          ssh -p "${DEPLOY_PORT:-22}" "${DEPLOY_USER}@${DEPLOY_HOST}" "bash -s -- \'$IMAGE\'" <<\'EOF\'',
      '          set -euo pipefail',
      '',
      '          podman container prune -f || true',
      '          podman image prune -a -f || true',
      '          podman system prune -f || true',
      '',
      '          IMAGE="$1"',
      '          HEALTH_URL="http://127.0.0.1:8080/health"',
      '',
      '          check_podman() {',
      '            local output',
      '            output=$(podman ps 2>&1) || {',
      '              echo "[deploy] podman ps command failed with exit code $?"',
      '              echo "$output"',
      '              return 1',
      '            }',
      '            if echo "$output" | grep -q "ERRO"; then',
      '              echo "[deploy] Podman reported errors in output:"',
      '              echo "$output" | grep "ERRO"',
      '              return 1',
      '            fi',
      '            return 0',
      '          }',
      '',
      '          attempt_lock_recovery() {',
      '            echo "[deploy] Podman lock/state issue detected, attempting recovery..."',
      '            pkill -u "$(id -u)" -f podman || true',
      '            sleep 2',
      '            podman system renumber || true',
      '            podman system migrate || true',
      '',
      '            if ! check_podman; then',
      '              echo "[deploy] Still unhealthy, performing aggressive lock cleanup..."',
      '              LOCK_BASE="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"',
      '              rm -rf "${LOCK_BASE}/containers/locks"/* >/dev/null 2>&1 || true',
      '              rm -rf "${LOCK_BASE}/libpod/tmp"/*lock* >/dev/null 2>&1 || true',
      '              STORAGE_DIR="${HOME}/.local/share/containers/storage"',
      '              rm -rf "${STORAGE_DIR}/libpod/locks"/* >/dev/null 2>&1 || true',
      '              rm -rf "${STORAGE_DIR}/libpod/tmp"/*lock* >/dev/null 2>&1 || true',
      '              podman unshare rm -rf "${STORAGE_DIR}/libpod/locks"/* >/dev/null 2>&1 || true',
      '              podman unshare rm -rf "${STORAGE_DIR}/libpod/tmp"/*lock* >/dev/null 2>&1 || true',
      '              podman system renumber || true',
      '              podman system migrate || true',
      '            fi',
      '          }',
      '',
      '          if ! check_podman; then',
      '            attempt_lock_recovery',
      '          fi',
      '',
      '          if ! check_podman; then',
      '            echo "[deploy] ERROR: Podman is still unhealthy after lock recovery attempts."',
      '            podman ps || true',
      '            exit 1',
      '          fi',
      '',
      '          echo "[deploy] Pulling image: ${IMAGE}"',
      '          podman pull "${IMAGE}"',
      '',
      '          echo "[deploy] Recreating api container"',
      '          podman stop panom >/dev/null 2>&1 || true',
      '          podman rm -f panom >/dev/null 2>&1 || true',
      '',
      '          echo "[deploy] Starting new api container..."',
      '          podman run -d \\',
      '            --env-file ~/.panom.env \\',
      '            -e PANOM_ENABLE_BACKGROUND_JOBS=false \\',
      '            -p 8080:8080 \\',
      '            --name panom \\',
      '            "${IMAGE}"',
      '',
      workerLines,
      '          if ! podman ps -a --format \'{{.Names}}\' | grep -qx \'panom\'; then',
      '            echo "[deploy] ERROR: Container \'panom\' failed to even create/start."',
      '            exit 1',
      '          fi',
      '',
      '          echo "[deploy] Verifying container is running..."',
      '          sleep 3',
      '          if ! podman ps --filter "name=panom" --filter "status=running" --format \'{{.Names}}\' | grep -qx \'panom\'; then',
      '            echo "[deploy] ERROR: Container \'panom\' is NOT in running state."',
      '            podman ps -a --filter "name=panom"',
      '            podman logs --tail 100 panom || true',
      '            exit 1',
      '          fi',
      '',
      '          echo "[deploy] Waiting for backend health: ${HEALTH_URL}"',
      '          healthy=0',
      '          for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do',
      '            if curl -fsS --max-time 5 "${HEALTH_URL}" >/dev/null; then',
      '              healthy=1',
      '              break',
      '            fi',
      '            echo "[deploy] Health check attempt $i failed, retrying..."',
      '            sleep 3',
      '          done',
      '',
      '          if [ "${healthy}" -ne 1 ]; then',
      '            echo "[deploy] ERROR: Backend health check failed after deploy."',
      '            podman ps -a --filter "name=panom"',
      '            podman logs --tail 200 panom || true',
      '            exit 1',
      '          fi',
      '',
      '          echo "[deploy] Backend is UP and healthy."',
      '          EOF',
      '',
    ].join('\n')
  }

  private backendQuadletWorkflow(
    apiSvc: NormalizedMeshServiceConfig,
    _workerSvc: NormalizedMeshServiceConfig | undefined,
    ci: NormalizedMeshCiConfig
  ): string {
    const backendImage = apiSvc.podman.image ?? 'ghcr.io/' + this.ghaCtx('github.repository') + '/panom-backend:latest'
    const secrets = ci.backend.envSecrets
    const plan = ci.drs.enabled ? this.frontendDrsPlan(apiSvc) : undefined
    const envSecretsLines = secrets.map(k => '          ' + k + ': ' + this.ghaSecret(k)).join('\n')
    const checkoutSteps = [
      '      - name: Checkout',
      '        uses: actions/checkout@v4',
      '',
      ...(ci.drs.enabled ? this.frontendDrsBootstrapSteps(plan!) : []),
    ]

    const setupNodeStep = [
      '      - name: Setup Node',
      '        uses: actions/setup-node@v4',
      '        with:',
      '          node-version: 20',
      '          cache: npm',
      ...(ci.drs.enabled ? ['          cache-dependency-path: package-lock.json'] : []),
      '',
    ]

    const installStep = ci.drs.enabled
      ? [
        '      - name: Install DRS dependencies',
        '        run: ' + plan!.installCommand,
        '',
      ]
      : [
        '      - name: Install root dependencies',
        '        run: npm ci',
        '',
      ]

    const buildImageStep = ci.drs.enabled
      ? [
        '      - name: Build backend image',
        '        run: docker build -t "$BACKEND_IMAGE" .',
        '',
      ]
      : [
        '      - name: Build backend image',
        '        run: docker build -t "$BACKEND_IMAGE" .',
        '',
      ]

    const generateQuadletStep = ci.drs.enabled
      ? [
        '      - name: Generate Quadlet files',
        '        env:',
        '          MESH_RUNTIME_MODE: podman',
        '          MESH_SECRET: ' + this.ghaSecret('MESH_SECRET'),
        '          REDIS_URL: ' + this.ghaSecret('REDIS_URL'),
        '          PANOM_BACKEND_IMAGE: ' + this.ghaEnv('BACKEND_IMAGE'),
        '          MESH_CONFIG_MOUNT_SOURCE: /home/' + this.ghaSecret('DEPLOY_USER') + '/.panom-mesh/runtime',
        envSecretsLines,
        '        run: npm run mesh:podman:generate -- --force --out .mesh/quadlet',
        '',
      ]
      : [
        '      - name: Generate Quadlet files',
        '        env:',
        '          MESH_RUNTIME_MODE: podman',
        '          MESH_SECRET: ' + this.ghaSecret('MESH_SECRET'),
        '          REDIS_URL: ' + this.ghaSecret('REDIS_URL'),
        '          PANOM_BACKEND_IMAGE: ' + this.ghaEnv('BACKEND_IMAGE'),
        '          MESH_CONFIG_MOUNT_SOURCE: /home/' + this.ghaSecret('DEPLOY_USER') + '/.panom-mesh/runtime',
        envSecretsLines,
        '        run: npm run mesh:podman:generate -- --force --out .mesh/quadlet',
        '',
      ]
    const quadletPath = '.mesh/quadlet/'

    return [
      'name: Deploy',
      '',
      'on:',
      '  push:',
      '    branches:',
      '      - ' + ci.branch,
      '',
      'concurrency:',
      '  group: deploy-backend',
      '  cancel-in-progress: false',
      '',
      'jobs:',
      '  deploy:',
      '    runs-on: ubuntu-latest',
      '',
      '    permissions:',
      '      contents: read',
      '      packages: write',
      '',
      '    env:',
      '      BACKEND_IMAGE: ' + backendImage,
      '',
      '    steps:',
      ...checkoutSteps,
      ...setupNodeStep,
      ...installStep,
      '',
      '      - name: Login GHCR',
      '        env:',
      '          GHCR_TOKEN: ' + this.ghaSecret('GITHUB_TOKEN'),
      '          GHCR_USER: ' + this.ghaCtx('github.actor'),
      '        run: |',
      '          for attempt in 1 2 3 4 5; do',
      '            echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin && exit 0',
      '            echo "GHCR login failed, retrying (${attempt}/5)..."',
      '            sleep $((attempt * 2))',
      '          done',
      '          exit 1',
      '',
      ...buildImageStep,
      '',
      '      - name: Push backend image',
      '        run: docker push "$BACKEND_IMAGE"',
      '',
      ...generateQuadletStep,
      '',
      '      - name: Setup SSH',
      '        env:',
      '          DEPLOY_SSH_KEY: ' + this.ghaSecret('DEPLOY_SSH_KEY'),
      '          DEPLOY_HOST: ' + this.ghaSecret('DEPLOY_HOST'),
      '          DEPLOY_PORT: ' + this.ghaSecret('DEPLOY_PORT'),
      '        run: |',
      '          mkdir -p ~/.ssh',
      '          echo "$DEPLOY_SSH_KEY" > ~/.ssh/id_rsa',
      '          chmod 600 ~/.ssh/id_rsa',
      '          ssh-keyscan -p "${DEPLOY_PORT:-22}" "$DEPLOY_HOST" >> ~/.ssh/known_hosts',
      '',
      '      - name: Upload quadlet files',
      '        env:',
      '          DEPLOY_HOST: ' + this.ghaSecret('DEPLOY_HOST'),
      '          DEPLOY_USER: ' + this.ghaSecret('DEPLOY_USER'),
      '          DEPLOY_PORT: ' + this.ghaSecret('DEPLOY_PORT'),
      '        run: |',
      "          ssh -p \"${DEPLOY_PORT:-22}\" \"${DEPLOY_USER}@${DEPLOY_HOST}\" 'mkdir -p ~/.config/containers/systemd'",
      '          rsync -az --delete -e "ssh -p ${DEPLOY_PORT:-22}" ' + quadletPath + ' "${DEPLOY_USER}@${DEPLOY_HOST}:~/.config/containers/systemd/"',
      '',
      '      - name: Reload and restart backend units',
      '        env:',
      '          DEPLOY_HOST: ' + this.ghaSecret('DEPLOY_HOST'),
      '          DEPLOY_USER: ' + this.ghaSecret('DEPLOY_USER'),
      '          DEPLOY_PORT: ' + this.ghaSecret('DEPLOY_PORT'),
      '        run: |',
      '          ssh -p "${DEPLOY_PORT:-22}" "${DEPLOY_USER}@${DEPLOY_HOST}" <<\'EOF\'',
      '            set -euo pipefail',
      '            QUADLET_DIR="$HOME/.config/containers/systemd"',
      '',
      "            podman ps --format '{{.Names}}' | grep '^panom-' | xargs -r podman rm -f || true",
      '',
      '            systemctl --user daemon-reload',
      '            systemctl --user reset-failed || true',
      '',
      "            mapfile -t APP_UNITS < <(find \"$QUADLET_DIR\" -maxdepth 1 -type f -name 'panom-*.container' ! -name 'panom-mesh-router.container' -printf '%f\\n' | sort)",
      '',
      '            for unit in "${APP_UNITS[@]}"; do systemctl --user restart "$unit"; done',
      '',
      "            systemctl --user --no-pager --plain list-units 'panom*'",
      '          EOF',
      '',
    ].join('\n')
  }

  // ─── GitHub Actions expression helpers ───────────────────────────────────
  // These avoid TypeScript template literal interpolation conflicts with ${{ }}

  /** Produces: ${{ secrets.KEY }} */
  private ghaSecret(key: string): string {
    return '${{ secrets.' + key + ' }}'
  }

  /** Produces: ${{ env.KEY }} */
  private ghaEnv(key: string): string {
    return '${{ env.' + key + ' }}'
  }

  /** Produces: ${{ github.actor }} etc. */
  private ghaCtx(path: string): string {
    return '${{ ' + path + ' }}'
  }
}
