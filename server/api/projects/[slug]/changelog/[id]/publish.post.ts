import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { changelogPost } from '~/server/database/schema/changelog'
import { createSuccessResponse, createErrorResponse, ErrorCode } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectCategoryAccess(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Changelog ID is required'),
    })
  }

  const [updated] = await db
    .update(changelogPost)
    .set({
      isDraft: false,
      publishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(changelogPost.id, id), eq(changelogPost.projectId, project.id)))
    .returning()

  if (!updated) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Changelog entry not found'),
    })
  }

  return createSuccessResponse(updated)
})
