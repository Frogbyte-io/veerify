/**
 * @openapi
 * /api/teams/{teamId}/modules:
 *   get:
 *     tags: [Teams]
 *     summary: Get which Veerify modules a team has enabled
 *     operationId: getTeamModuleSettings
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Module settings }
 *       403: { description: Not a member of this team }
 */
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { teamMember } from '~/server/database/schema/auth'
import { teamModuleSettings } from '~/server/database/schema/teams'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'

/**
 * Defaults for a team with no row yet. Must match the column defaults in
 * `teams.ts` — a team that has never opened the Tools tab has no row, and it
 * must read identically to one that has (delta D-31).
 */
export const DEFAULT_TEAM_MODULES = {
  feedbackEnabled: true,
  roadmapEnabled: false,
  changelogEnabled: false,
  supportEnabled: false,
}

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)

  const teamId = getRouterParam(event, 'teamId')
  if (!teamId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Team ID is required'),
    })
  }

  // Team membership only — restricting module toggles to team admins was
  // considered and deliberately deferred (delta D-28). Do not add a role check
  // here without reading that entry first.
  const [membership] = await db
    .select({ id: teamMember.id })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, session.user.id)))
    .limit(1)

  if (!membership) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You are not a member of this team'),
    })
  }

  const [row] = await db.select().from(teamModuleSettings).where(eq(teamModuleSettings.teamId, teamId)).limit(1)

  return createSuccessResponse({
    modules: row
      ? {
          feedbackEnabled: row.feedbackEnabled,
          roadmapEnabled: row.roadmapEnabled,
          changelogEnabled: row.changelogEnabled,
          supportEnabled: row.supportEnabled,
        }
      : { ...DEFAULT_TEAM_MODULES },
  })
})
