import { isModuleEnabled, type ModuleKey } from '~/lib/modules'

/** Whether a tool is on for a project (anonymous endpoints). Tools are switched per project only. */
export function isModuleEnabledForProject(
  projectSettings: Record<string, unknown> | null | undefined,
  key: ModuleKey
): boolean {
  return isModuleEnabled(projectSettings, key)
}
