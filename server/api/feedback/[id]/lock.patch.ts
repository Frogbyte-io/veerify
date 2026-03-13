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

  const [updated] = await db
    .update(feedback)
    .set({ isLocked: !fb.isLocked, updatedAt: new Date() })
    .where(eq(feedback.id, id))
    .returning()

  return createSuccessResponse(updated)
})
