/**
 * @openapi
 * /api/support/teams/{teamId}/csat-surveys:
 *   get:
 *     tags: [Support]
 *     summary: List team CSAT surveys
 *     operationId: listSupportCsatSurveys
 *     responses:
 *       200: { description: CSAT survey configurations }
 *       403: { description: Not a member of the team }
 */
import { asc, eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireSupportTeamRole } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { csatSurvey } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const teamId = getRouterParam(event, 'teamId') as string
  await requireSupportTeamRole(teamId, session.user.id, 'agent')

  const surveys = await db
    .select()
    .from(csatSurvey)
    .where(eq(csatSurvey.teamId, teamId))
    .orderBy(asc(csatSurvey.createdAt), asc(csatSurvey.id))
  return createSuccessResponse({ surveys })
})
