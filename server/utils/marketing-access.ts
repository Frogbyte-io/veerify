import { eq } from 'drizzle-orm'
// Imported explicitly rather than relying on Nuxt's auto-import, so this module
// can be unit tested outside the Nitro runtime.
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import { teamModuleSettings } from '~/server/database/schema/teams'
import { DEFAULT_TEAM_MODULES, resolveProductModules } from '~/lib/modules'
import { requireProjectAccess } from './project-access'
import { requireTeamAdmin } from './support-access'
import { createErrorResponse, ErrorCode } from './response'

function forbidden(message: string): never {
  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    data: createErrorResponse(ErrorCode.FORBIDDEN, message),
  })
}

/**
 * Authorizes a marketing endpoint for a project.
 *
 * Verifies team membership (404 unknown project, 403 non-member), then that the
 * Marketing module is on for both the team and the product. A team that never
 * opened the Tools tab has no `team_module_settings` row and reads as the
 * registry default (off).
 */
export async function requireMarketingAccess(projectId: string, userId: string) {
  const project = await requireProjectAccess(projectId, userId)

  const [row] = await db
    .select({ marketingEnabled: teamModuleSettings.marketingEnabled })
    .from(teamModuleSettings)
    .where(eq(teamModuleSettings.teamId, project.teamId))
    .limit(1)

  const teamEnabled = row ? row.marketingEnabled === true : DEFAULT_TEAM_MODULES.marketingEnabled
  if (!teamEnabled) {
    forbidden('Marketing is not enabled for this team')
  }

  const productModules = resolveProductModules(project.settings as Record<string, unknown> | null)
  if (!productModules.marketingEnabled) {
    forbidden('Marketing is not enabled for this product')
  }

  return { project, teamId: project.teamId }
}

/** Marketing access plus team admin, for managing keys, budgets and site settings. */
export async function requireMarketingAdmin(projectId: string, userId: string) {
  const access = await requireMarketingAccess(projectId, userId)

  try {
    await requireTeamAdmin(access.teamId, userId)
  } catch (error) {
    // requireTeamAdmin's message is support-specific; surface a marketing one
    if ((error as { statusCode?: number })?.statusCode === 403) {
      forbidden('Only team admins can manage Marketing settings')
    }
    throw error
  }

  return access
}

/**
 * Team admin on the product's team, whether or not Marketing is currently switched on. Exporting or
 * deleting a product's Marketing data must stay possible after the module is turned off, because
 * switching it off hides the data but does not remove it.
 */
export async function requireMarketingDataAdmin(projectId: string, userId: string) {
  const project = await requireProjectAccess(projectId, userId)
  try {
    await requireTeamAdmin(project.teamId, userId)
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 403) {
      forbidden('Only team admins can export or delete Marketing data')
    }
    throw error
  }
  return { project, teamId: project.teamId }
}
