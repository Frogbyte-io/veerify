import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireProjectAccess } from '~/server/utils/project-access'
import { validateBody } from '~/server/utils/validation'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory, project } from '~/server/database/schema/feedback'
import { teamMember } from '~/server/database/schema/auth'

const updateFeedbackSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title too long'),
  body: z.string().trim().min(1, 'Description is required').max(5000, 'Description too long'),
  categoryId: z.string().trim().optional().nullable(),
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
  } else {
    const [proj] = await db
      .select({ teamId: project.teamId })
      .from(project)
      .where(eq(project.id, item.projectId))
      .limit(1)

    if (proj) {
      const [membership] = await db
        .select({ id: teamMember.id })
        .from(teamMember)
        .where(and(eq(teamMember.teamId, proj.teamId), eq(teamMember.userId, session.user.id)))
        .limit(1)
      canManageProject = Boolean(membership)
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
      metadata: nextMetadata,
      updatedAt: new Date(),
    })
    .where(eq(feedback.id, id))
    .returning()

  return createSuccessResponse({
    ...updated,
    tag: nextMetadata.feedbackType || null,
    canEdit: true,
    canDelete: true,
    canManage: canManageProject,
  })
})
