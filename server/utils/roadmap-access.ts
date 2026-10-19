import { eq } from 'drizzle-orm'
// Imported explicitly rather than relying on Nuxt's auto-import, so this module
// can be unit tested outside the Nitro runtime.
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import { teamModuleSettings } from '~/server/database/schema/teams'
import { DEFAULT_TEAM_MODULES, resolveProductModules } from '~/lib/modules'
import { requireProjectAccess } from './project-access'
import { createErrorResponse, ErrorCode } from './response'

function forbidden(message: string): never {
  throw createError({
    statusCode: 403,
    statusMessage: 'Forbidden',
    data: createErrorResponse(ErrorCode.FORBIDDEN, message),
  })
}

/**
 * Authorizes a roadmap endpoint for a project.
 *
 * Verifies team membership (404 unknown project, 403 non-member), then that the
 * Roadmap module is on for both the team and the product. A team that never
 * opened the Tools tab has no `team_module_settings` row and reads as the
 * registry default (off).
 */
export async function requireRoadmapAccess(projectId: string, userId: string) {
  const project = await requireProjectAccess(projectId, userId)

  const [row] = await db
    .select({ roadmapEnabled: teamModuleSettings.roadmapEnabled })
    .from(teamModuleSettings)
    .where(eq(teamModuleSettings.teamId, project.teamId))
    .limit(1)

  const teamEnabled = row ? row.roadmapEnabled === true : DEFAULT_TEAM_MODULES.roadmapEnabled
  if (!teamEnabled) {
    forbidden('Roadmap is not enabled for this team')
  }

  const productModules = resolveProductModules(project.settings as Record<string, unknown> | null)
  if (!productModules.roadmapEnabled) {
    forbidden('Roadmap is not enabled for this product')
  }

  return { project, teamId: project.teamId }
}
