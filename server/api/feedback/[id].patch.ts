import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { requireAuth } from '~/server/utils/auth-middleware'
import { hasProjectAccess, requireProjectAccess, requireProductInProject } from '~/server/utils/project-access'
import { validateBody } from '~/server/utils/validation'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory, product } from '~/server/database/schema/feedback'

const updateFeedbackSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title too long'),
  body: z.string().trim().min(1, 'Description is required').max(5000, 'Description too long'),
  categoryId: z.string().trim().optional().nullable(),
  // Move to another product of the same project (project members only)
  productId: z.string().trim().min(1).optional(),
  feedbackType: z.enum(['feature_request', 'bug_report', 'improvement', 'question', 'other']).optional().nullable(),
})

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

  const body = await validateBody(event, updateFeedbackSchema)

  const [item] = await db.select().from(feedback).where(eq(feedback.id, id)).limit(1)
  if (!item) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Feedback not found'),
    })
  }

  const isAuthor = item.authorUserId === session.user.id
  let canManageProject = false

  if (isAuthor) {
    // Authors keep edit rights, but "manage" (moving products) needs project access
    canManageProject = await hasProjectAccess(item.projectId, session.user.id)
  }

  if (!isAuthor) {
    try {
      await requireProjectAccess(item.projectId, session.user.id)
      canManageProject = true
    } catch {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        data: createErrorResponse(ErrorCode.FORBIDDEN, 'You do not have permission to edit this feedback'),
      })
    }
  }

  let nextCategoryId = item.categoryId
  if (body.categoryId !== undefined) {
    if (body.categoryId === null || body.categoryId === '') {
      nextCategoryId = null
    } else {
      const [category] = await db
        .select({ id: feedbackCategory.id, projectId: feedbackCategory.projectId })
        .from(feedbackCategory)
        .where(eq(feedbackCategory.id, body.categoryId))
        .limit(1)

      if (!category || category.projectId !== item.projectId) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Bad Request',
          data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Invalid category for this feedback'),
        })
      }

      nextCategoryId = category.id
    }
  }

  let nextProductId = item.productId
  if (body.productId !== undefined && body.productId !== item.productId) {
    if (!canManageProject) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        data: createErrorResponse(ErrorCode.FORBIDDEN, 'Only project members can move feedback to another product'),
      })
    }
    nextProductId = (await requireProductInProject(item.projectId, body.productId)).id
  }

  const existingMetadata = item.metadata || {}
  const nextMetadata = {
    ...existingMetadata,
    feedbackType:
      body.feedbackType === undefined ? (existingMetadata.feedbackType ?? null) : (body.feedbackType ?? null),
  }

  const [updated] = await db
    .update(feedback)
    .set({
      title: body.title,
      body: body.body,
      categoryId: nextCategoryId,
      productId: nextProductId,
      metadata: nextMetadata,
      updatedAt: new Date(),
    })
    .where(eq(feedback.id, id))
    .returning()

  const [productSummary] = await db
    .select({ id: product.id, name: product.name, slug: product.slug })
    .from(product)
    .where(eq(product.id, updated.productId))
    .limit(1)

  return createSuccessResponse({
    ...updated,
    product: productSummary ?? null,
    tag: nextMetadata.feedbackType || null,
    canEdit: true,
    canDelete: true,
    canManage: canManageProject,
  })
})
