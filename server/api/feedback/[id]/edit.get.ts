import { eq } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { db } from '~/server/database/drizzle'
import { feedback, project } from '~/server/database/schema/feedback'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Feedback ID is required'),
    })
  }

  const token = getQuery(event).token as string | undefined
  if (!token) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Edit token is required'),
    })
  }

  const [item] = await db
    .select({
      id: feedback.id,
      title: feedback.title,
      body: feedback.body,
      projectId: feedback.projectId,
      metadata: feedback.metadata,
    })
    .from(feedback)
    .where(eq(feedback.id, id))
    .limit(1)

  if (!item) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Feedback not found'),
    })
  }

  if (!item.metadata?.editToken || item.metadata.editToken !== token) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'Invalid or expired edit link'),
    })
  }

  if (item.metadata.editTokenExpiry && new Date(item.metadata.editTokenExpiry) < new Date()) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'This edit link has expired'),
    })
  }

  const [proj] = await db
    .select({ name: project.name })
    .from(project)
    .where(eq(project.id, item.projectId))
    .limit(1)

  return createSuccessResponse({
    id: item.id,
    title: item.title,
    body: item.body,
    projectName: proj?.name || '',
  })
})
