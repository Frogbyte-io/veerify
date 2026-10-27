/**
 * @openapi
 * /api/feedback/{id}/pin:
 *   patch:
 *     tags: [Feedback]
 *     summary: Toggle pinned state
 *     description: >
 *       Flips `isPinned` on the item (no request body). Project members only. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: toggleFeedbackPin
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
 *       200: { description: "Updated feedback item" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "No access to the feedback project" }
 *       404: { description: "Feedback not found" }
 */
import { eq } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireProjectAccess } from '~/server/utils/project-access'
import { db } from '~/server/database/drizzle'
import { feedback } from '~/server/database/schema/feedback'

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

  const [fb] = await db.select().from(feedback).where(eq(feedback.id, id)).limit(1)
  if (!fb) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Feedback not found'),
    })
  }

  await requireProjectAccess(fb.projectId, session.user.id)

  const now = new Date()
  const [updated] = await db
    .update(feedback)
    .set({ isPinned: !fb.isPinned, updatedAt: now })
    .where(eq(feedback.id, id))
    .returning()

  return createSuccessResponse(updated)
})
