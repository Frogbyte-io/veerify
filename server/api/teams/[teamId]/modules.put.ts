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
import { db } from '~/server/database/drizzle'
import { teamModuleSettings } from '~/server/database/schema/teams'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { requireTeamAdmin } from '~/server/utils/support-access'
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

  await requireTeamAdmin(teamId, session.user.id)
  const body = await validateBody(event, bodySchema)

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
