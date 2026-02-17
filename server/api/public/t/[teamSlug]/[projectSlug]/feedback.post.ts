import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { getOrCreateAnonSession } from '~/server/utils/anonymous-session'
import { validateBody } from '~/server/utils/validation'
import { resolvePublicProjectByTeam } from '~/server/utils/project-access'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory, vote } from '~/server/database/schema/feedback'

const submitFeedbackSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  body: z.string().min(1, 'Description is required').max(5000, 'Description too long'),
  categoryId: z.string().optional().nullable(),
  authorName: z.string().min(1, 'Name is required').max(100).optional(),
  authorEmail: z.string().email('Invalid email').optional(),
})

export default defineEventHandler(async (event) => {
  const teamSlug = getRouterParam(event, 'teamSlug')
  const projectSlug = getRouterParam(event, 'projectSlug')

  const session = await optionalAuth(event)
  const body = await validateBody(event, submitFeedbackSchema)

  const { project: proj } = await resolvePublicProjectByTeam(teamSlug!, projectSlug!)

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

  if (!session?.user && !body.authorName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Name is required'),
    })
  }

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
      voteCount: 1,
      commentCount: 0,
      isPinned: false,
      isLocked: false,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  // Auto-upvote by the submitter so the item appears ranked without a second click
  await db.insert(vote).values({
    id: crypto.randomUUID(),
    feedbackId: created.id,
    voterUserId: session?.user?.id || null,
    voterSessionId: anonSessionId,
    createdAt: now,
  })

  setResponseStatus(event, 201)
  return createSuccessResponse({
    id: created.id,
    title: created.title,
    status: created.status,
    createdAt: created.createdAt,
  })
})
