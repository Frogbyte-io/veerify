/**
 * @openapi
 * /api/support/teams/{teamId}/csat-surveys/{id}:
 *   delete:
 *     tags: [Support]
 *     summary: Delete a team CSAT survey
 *     operationId: deleteSupportCsatSurvey
 *     responses:
 *       200: { description: CSAT survey deleted }
 *       403: { description: Team administrator required }
 *       404: { description: Survey not found }
 */
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireTeamAdmin } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { csatSurvey } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const teamId = getRouterParam(event, 'teamId') as string
  const id = getRouterParam(event, 'id') as string
  await requireTeamAdmin(teamId, session.user.id)

  const deleted = await db
    .delete(csatSurvey)
    .where(and(eq(csatSurvey.id, id), eq(csatSurvey.teamId, teamId)))
    .returning({ id: csatSurvey.id })
  if (!deleted[0]) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'CSAT survey not found'),
    })
  }
  return createSuccessResponse({ deleted: true })
})
