/**
 * @openapi
 * /api/support/projects/{projectId}/csat-surveys:
 *   get:
 *     tags: [Support]
 *     summary: List project CSAT surveys
 *     operationId: listSupportCsatSurveys
 *     responses:
 *       200: { description: CSAT survey configurations }
 *       403: { description: Not a member of the project }
 */
import { asc, eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireSupportProjectRole } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { csatSurvey } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  await requireSupportProjectRole(projectId, session.user.id, 'agent')

  const surveys = await db
    .select()
    .from(csatSurvey)
    .where(eq(csatSurvey.projectId, projectId))
    .orderBy(asc(csatSurvey.createdAt), asc(csatSurvey.id))
  return createSuccessResponse({ surveys })
})
