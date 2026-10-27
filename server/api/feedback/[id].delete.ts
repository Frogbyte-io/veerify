/**
 * @openapi
 * /api/feedback/{id}:
 *   delete:
 *     tags: [Feedback]
 *     summary: Delete a feedback item
 *     description: >
 *       Permanently deletes the item. Allowed for the author or anyone with access to the feedback project. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: deleteFeedback
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Feedback id
 *         schema: { type: string }
 *     responses:
 *       200: { description: "Deleted; data is { id, deleted: true }" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Not the author and no project access" }
 *       404: { description: "Feedback not found" }
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedback } from '~/server/database/schema/feedback'
import { requireAuth } from '~/server/utils/auth-middleware'
import { hasProjectAccess } from '~/server/utils/project-access'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Feedback ID is required'),
    })
  }

  const [item] = await db.select().from(feedback).where(eq(feedback.id, id)).limit(1)
  if (!item) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Feedback not found'),
    })
  }

  // Allow deletion if user is the author
  const isAuthor = item.authorUserId === session.user.id

  if (!isAuthor) {
    // Otherwise the caller must have access to the feedback's project
    if (!(await hasProjectAccess(item.projectId, session.user.id))) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        data: createErrorResponse(ErrorCode.FORBIDDEN, 'You do not have permission to delete this feedback'),
      })
    }
  }

  await db.delete(feedback).where(eq(feedback.id, id))

  return createSuccessResponse({ id, deleted: true })
})
