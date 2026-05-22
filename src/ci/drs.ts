import { loadConfig, getVendoringPlan, getPackageEntry } from '@panomapp/drs';

export type { VendoringPlan as DrsWorkflowPlan, VendoredSourcePackage as DrsSourcePackagePlan } from '@panomapp/drs';

export function getDrsWorkflowPlan(projectRoot: string, consumerCwd: string) {
  const config = loadConfig({ cwd: projectRoot });
  return getVendoringPlan(config, consumerCwd);
}

export function getDrsPackageEntry(projectRoot: string, packageName: string) {
  const config = loadConfig({ cwd: projectRoot });
  return getPackageEntry(config, packageName);
}

export { formatNpmInstallCommand } from '@panomapp/drs';
