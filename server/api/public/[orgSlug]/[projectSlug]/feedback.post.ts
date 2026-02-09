import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { getOrCreateAnonSession } from '~/server/utils/anonymous-session'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { project, feedback, feedbackCategory } from '~/server/database/schema/feedback'
import { organization } from '~/server/database/schema/auth'

const submitFeedbackSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  body: z.string().min(1, 'Description is required').max(5000, 'Description too long'),
  categoryId: z.string().optional().nullable(),
  authorName: z.string().min(1, 'Name is required').max(100).optional(),
  authorEmail: z.string().email('Invalid email').optional(),
})

export default defineEventHandler(async (event) => {
  const orgSlug = getRouterParam(event, 'orgSlug')
  const projectSlug = getRouterParam(event, 'projectSlug')

  if (!orgSlug || !projectSlug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Organization and project slugs are required'),
    })
  }

  const session = await optionalAuth(event)
  const body = await validateBody(event, submitFeedbackSchema)

  // Resolve org + project
  const [org] = await db.select().from(organization).where(eq(organization.slug, orgSlug)).limit(1)
  if (!org) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Organization not found'),
    })
  }

  const [proj] = await db
    .select()
    .from(project)
    .where(and(eq(project.organizationId, org.id), eq(project.slug, projectSlug)))
    .limit(1)

  if (!proj || !proj.isPublic) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Project not found'),
    })
  }

  // Validate category
  if (body.categoryId) {
    const [cat] = await db
      .select()
      .from(feedbackCategory)
      .where(and(eq(feedbackCategory.id, body.categoryId), eq(feedbackCategory.projectId, proj.id)))
      .limit(1)
    if (!cat) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Invalid category'),
      })
    }
  }

  // For anonymous submissions, require name
  if (!session?.user && !body.authorName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Name is required'),
    })
  }

  // For anonymous users, get or create an anonymous session
  let anonSessionId: string | null = null
  if (!session?.user) {
    const anonSession = await getOrCreateAnonSession(event)
    anonSessionId = anonSession.id
  }

  const now = new Date()
  const [created] = await db
    .insert(feedback)
    .values({
      id: crypto.randomUUID(),
      projectId: proj.id,
      categoryId: body.categoryId || null,
      title: body.title,
      body: body.body,
      status: 'open',
      authorUserId: session?.user?.id || null,
      authorSessionId: anonSessionId,
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
  return createSuccessResponse({
    id: created.id,
    title: created.title,
    status: created.status,
    createdAt: created.createdAt,
  })
})
