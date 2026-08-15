/**
 * @openapi
 * /api/teams/{teamId}/modules:
 *   put:
 *     tags: [Teams]
 *     summary: Enable or disable Veerify modules for a team
 *     description: >
 *       Team-level module enablement is a master switch over the per-project
 *       feature toggles - both must be on for a product to show a module
 *       (delta D-31). Disabling a module hides it but destroys nothing.
 *     operationId: updateTeamModuleSettings
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Module settings updated }
 *       403: { description: Not a member of this team }
 */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { teamMember } from '~/server/database/schema/auth'
import { teamModuleSettings } from '~/server/database/schema/teams'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { DEFAULT_TEAM_MODULES } from './modules.get'

const bodySchema = z.object({
  feedbackEnabled: z.boolean().optional(),
  roadmapEnabled: z.boolean().optional(),
  changelogEnabled: z.boolean().optional(),
  supportEnabled: z.boolean().optional(),
})

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

  const body = await validateBody(event, bodySchema)

  // Team membership only — see delta D-28 before adding a role check.
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

  const now = new Date()

  // Upsert: most teams have no row until the first toggle. The insert carries
  // the defaults for any field the request omits, so a partial PUT on a team
  // with no row cannot silently write `false` into the others.
  const [row] = await db
    .insert(teamModuleSettings)
    .values({
      teamId,
      ...DEFAULT_TEAM_MODULES,
      ...body,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: teamModuleSettings.teamId,
      set: { ...body, updatedAt: now },
    })
    .returning()

  return createSuccessResponse({
    modules: {
      feedbackEnabled: row.feedbackEnabled,
      roadmapEnabled: row.roadmapEnabled,
      changelogEnabled: row.changelogEnabled,
      supportEnabled: row.supportEnabled,
    },
  })
})
