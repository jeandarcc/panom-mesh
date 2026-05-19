import fs from 'node:fs'
import path from 'node:path'
import { pathExists } from '../utils/fs.js'

export class InitCommand {
  public async run(projectRoot = process.cwd()): Promise<string> {
    const configPath = path.join(projectRoot, 'mesh.config.ts')
    const packagePath = path.join(projectRoot, 'package.json')

    if (!(await pathExists(configPath))) {
      await fs.promises.writeFile(configPath, this.configTemplate(), 'utf8')
    }

    if (await pathExists(packagePath)) {
      await this.patchPackageJson(packagePath)
    }

    return `Mesh initialized.\n\nCreated or verified:\n- mesh.config.ts\n- package.json scripts\n\nRun:\n  npm run mesh:run\n  npm run mesh:run:all\n  npm run mesh:ps\n  npm run mesh:dashboard\n`
  }

  private async patchPackageJson(packagePath: string): Promise<void> {
    const text = await fs.promises.readFile(packagePath, 'utf8')
    const pkg = JSON.parse(text) as { scripts?: Record<string, string> }
    pkg.scripts ??= {}
    pkg.scripts['mesh:init'] ??= 'mesh init'
    pkg.scripts['mesh:run'] ??= 'mesh run'
    pkg.scripts['mesh:run:all'] ??= 'mesh run --all'
    pkg.scripts['mesh:ps'] ??= 'mesh ps'
    pkg.scripts['mesh:watch'] ??= 'mesh watch'
    pkg.scripts['mesh:dashboard'] ??= 'mesh dashboard'
    pkg.scripts['mesh:stream'] ??= 'mesh stream'
    pkg.scripts['mesh:locks'] ??= 'mesh locks'
    pkg.scripts['mesh:leaders'] ??= 'mesh leaders'
    pkg.scripts['mesh:cleanup'] ??= 'mesh cleanup'
    pkg.scripts['mesh:stop'] ??= 'mesh stop'
    await fs.promises.writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  }

  private configTemplate(): string {
    return `import { defineMeshConfig } from '@panomapp/mesh'\n\nexport default defineMeshConfig({\n  app: 'my-app',\n\n  router: {\n    port: 8080,\n    host: '127.0.0.1',\n    sessionAffinity: true,\n    secret: process.env.MESH_SECRET ?? 'dev-only-change-me'\n  },\n\n  runtime: {\n    mode: 'process',\n    stateDir: '.mesh',\n    logsDir: '.mesh/logs',\n    defaultWatch: true,\n    portRange: { from: 3100, to: 3999 }\n  },\n\n  coordination: {
    enabled: false,
    backend: 'memory'
  },

  services: {\n    frontend: {\n      type: 'frontend',\n      command: 'npm run dev',\n      cwd: './frontend',\n      instances: 1,\n      route: '/',\n      port: 5173,\n      watch: true\n    },\n\n    api: {\n      type: 'backend',\n      command: 'npm run dev',\n      cwd: './backend',\n      instances: 2,\n      route: '/api',\n      healthPath: '/health',\n      strategy: 'session-affinity',\n      watch: true\n    },\n\n    worker: {\n      type: 'worker',\n      command: 'npm run worker',\n      cwd: './backend',\n      instances: 1,\n      watch: false\n    }\n  }\n})\n`
  }
}
