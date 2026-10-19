import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { teamModuleSettings } from '~/server/database/schema/teams'
import { DEFAULT_TEAM_MODULES, resolveProductModules, type ModuleKey } from '~/lib/modules'

/**
 * Whether a module is on for the team (anonymous endpoints). A team that never
 * opened the Tools tab has no row and reads as the registry default.
 */
export async function isTeamModuleEnabled(teamId: string, key: ModuleKey): Promise<boolean> {
  const [row] = await db.select().from(teamModuleSettings).where(eq(teamModuleSettings.teamId, teamId)).limit(1)
  return row ? (row as Record<string, unknown>)[key] === true : DEFAULT_TEAM_MODULES[key]
}

/** Team and product switch for a module, for anonymous endpoints. */
export async function isModuleEnabledForProject(
  teamId: string,
  projectSettings: Record<string, unknown> | null | undefined,
  key: ModuleKey
): Promise<boolean> {
  if (resolveProductModules(projectSettings)[key] !== true) return false
  return isTeamModuleEnabled(teamId, key)
}
