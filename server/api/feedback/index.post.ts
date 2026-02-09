import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { feedback, project, feedbackCategory } from '~/server/database/schema/feedback'

const createFeedbackSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  body: z.string().min(1, 'Description is required').max(5000, 'Description too long'),
  projectId: z.string().min(1, 'Project ID is required'),
  categoryId: z.string().optional().nullable(),
  authorName: z.string().min(1).max(100).optional(),
  authorEmail: z.string().email().optional(),
})

export default defineEventHandler(async (event) => {
  // Optional auth — allows anonymous submissions
  const session = await optionalAuth(event)

  const body = await validateBody(event, createFeedbackSchema)

  // Verify project exists and is public
  const [proj] = await db.select().from(project).where(eq(project.id, body.projectId)).limit(1)
  if (!proj) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Project not found'),
    })
  }

  if (!proj.isPublic && !session?.user) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'This project does not accept public feedback'),
    })
  }

  // Verify category if provided
  if (body.categoryId) {
    const [cat] = await db
      .select()
      .from(feedbackCategory)
      .where(eq(feedbackCategory.id, body.categoryId))
      .limit(1)
    if (!cat || cat.projectId !== proj.id) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Invalid category for this project'),
      })
    }
  }

  // For anonymous submissions, require name
  if (!session?.user && !body.authorName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Name is required for anonymous submissions'),
    })
  }

  const now = new Date()
  const [created] = await db
    .insert(feedback)
    .values({
      id: crypto.randomUUID(),
      projectId: body.projectId,
      categoryId: body.categoryId || null,
      title: body.title,
      body: body.body,
      status: 'open',
      authorUserId: session?.user?.id || null,
      authorName: session?.user ? session.user.name : body.authorName || null,
      authorEmail: session?.user ? session.user.email : body.authorEmail || null,
      voteCount: 0,
      commentCount: 0,
      isPinned: false,
      isLocked: false,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  setResponseStatus(event, 201)
  return createSuccessResponse(created)
})
