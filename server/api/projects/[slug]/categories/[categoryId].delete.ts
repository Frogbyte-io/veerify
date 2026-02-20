import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory } from '~/server/database/schema/feedback'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'

const deleteCategorySchema = z.object({
  replacementCategoryId: z.string().min(1).optional().nullable(),
})

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectCategoryAccess(event)
  const categoryId = getRouterParam(event, 'categoryId')

  if (!categoryId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Category ID is required'),
    })
  }

  const rawBody = (await readBody(event).catch(() => ({}))) ?? {}
  const parsedBody = deleteCategorySchema.safeParse(rawBody)
  if (!parsedBody.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Validation failed',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Request validation failed', parsedBody.error.issues),
    })
  }
  const body = parsedBody.data

  const [category] = await db
    .select()
    .from(feedbackCategory)
    .where(and(eq(feedbackCategory.id, categoryId), eq(feedbackCategory.projectId, project.id)))
    .limit(1)

  if (!category) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Category not found'),
    })
  }

  if (category.isDefault) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'Default categories cannot be deleted'),
    })
  }

  const [usage] = await db
    .select({ count: count() })
    .from(feedback)
    .where(and(eq(feedback.projectId, project.id), eq(feedback.categoryId, category.id)))

  const usageCount = usage?.count ?? 0
  if (usageCount > 0 && !body.replacementCategoryId) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(
        ErrorCode.CONFLICT,
        'Category is used by feedback items. Provide replacementCategoryId before deletion.'
      ),
    })
  }

  if (usageCount > 0 && body.replacementCategoryId) {
    const [replacement] = await db
      .select()
      .from(feedbackCategory)
      .where(and(eq(feedbackCategory.id, body.replacementCategoryId), eq(feedbackCategory.projectId, project.id)))
      .limit(1)

    if (!replacement || replacement.id === category.id) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Replacement category is invalid'),
      })
    }

    await db
      .update(feedback)
      .set({ categoryId: replacement.id })
      .where(and(eq(feedback.projectId, project.id), eq(feedback.categoryId, category.id)))
  }

  await db
    .delete(feedbackCategory)
    .where(and(eq(feedbackCategory.id, category.id), eq(feedbackCategory.projectId, project.id)))

  return createSuccessResponse({ id: category.id, deleted: true })
})
