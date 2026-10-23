/**
 * @openapi
 * /api/support/projects/{projectId}/csat-surveys/{id}:
 *   delete:
 *     tags: [Support]
 *     summary: Delete a project CSAT survey
 *     operationId: deleteSupportCsatSurvey
 *     responses:
 *       200: { description: CSAT survey deleted }
 *       409: { description: CSAT survey has responses and must be disabled }
 *       403: { description: Project administrator required }
 *       404: { description: Survey not found }
 */
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireProjectAdmin } from '~/server/utils/project-access'
import { db } from '~/server/database/drizzle'
import { csatResponse, csatSurvey } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  const id = getRouterParam(event, 'id') as string
  await requireProjectAdmin(projectId, session.user.id)

  await db.transaction(async (tx) => {
    const [survey] = await tx
      .select({ id: csatSurvey.id })
      .from(csatSurvey)
      .where(and(eq(csatSurvey.id, id), eq(csatSurvey.projectId, projectId)))
      .for('update')
      .limit(1)

    if (!survey) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        data: createErrorResponse(ErrorCode.NOT_FOUND, 'CSAT survey not found'),
      })
    }

    // Responses are historical reporting facts. Deleting the survey would
    // cascade them, while any queued CSAT message could still be delivered.
    // Disable the survey instead once dispatch has started.
    const [response] = await tx
      .select({ id: csatResponse.id })
      .from(csatResponse)
      .where(eq(csatResponse.surveyId, id))
      .limit(1)

    if (response) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(
          ErrorCode.CONFLICT,
          'CSAT surveys with responses cannot be deleted; disable it instead'
        ),
      })
    }

    await tx.delete(csatSurvey).where(eq(csatSurvey.id, id))
  })

  return createSuccessResponse({ deleted: true })
})
