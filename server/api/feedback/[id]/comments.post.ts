import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { requirePublicProject, requireProjectAccess } from '~/server/utils/project-access'
import { getOrCreateAnonSession } from '~/server/utils/anonymous-session'
import { validateBody } from '~/server/utils/validation'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackComment, feedbackSubscription } from '~/server/database/schema/feedback'
import { user } from '~/server/database/schema/auth'
import { sendNewCommentNotificationEmail } from '~/lib/email'

const createCommentSchema = z.object({
  body: z.string().min(1, 'Comment body is required').max(5000, 'Comment too long'),
  parentCommentId: z.string().optional().nullable(),
  isInternal: z.boolean().optional().default(false),
  authorName: z.string().min(1).max(100).optional(),
  authorEmail: z.string().email().optional(),
})

export default defineEventHandler(async (event) => {
  await requireRateLimit(event, { ...rateLimits.standard, identifier: 'feedback-comment' })

  const session = await optionalAuth(event)
  const body = await validateBody(event, createCommentSchema)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Feedback ID is required'),
    })
  }

  // Verify feedback exists and is not locked
  const [fb] = await db.select().from(feedback).where(eq(feedback.id, id)).limit(1)
  if (!fb) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Feedback not found'),
    })
  }

  if (fb.isLocked) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'This feedback is locked and does not accept new comments'),
    })
  }

  // Verify access - internal comments require team membership
  let isTeamMember = false
  if (session?.user) {
    try {
      await requireProjectAccess(fb.projectId, session.user.id)
      isTeamMember = true
    } catch {
      await requirePublicProject(fb.projectId)
    }
  } else {
    await requirePublicProject(fb.projectId)
  }

  // Internal comments require team membership
  if (body.isInternal && !isTeamMember) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'Only team members can post internal comments'),
    })
  }

  // Anonymous users must provide a name
  if (!session?.user && !body.authorName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Name is required for anonymous comments'),
    })
  }

  // Validate parent comment if provided
  if (body.parentCommentId) {
    const [parent] = await db
      .select()
      .from(feedbackComment)
      .where(eq(feedbackComment.id, body.parentCommentId))
      .limit(1)
    if (!parent || parent.feedbackId !== id) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Invalid parent comment'),
      })
    }
  }

  // For anonymous users, get or create an anonymous session
  let anonSessionId: string | null = null
  if (!session?.user) {
    const anonSession = await getOrCreateAnonSession(event)
    anonSessionId = anonSession.id
  }

  const now = new Date()
  const [created] = await db
    .insert(feedbackComment)
    .values({
      id: crypto.randomUUID(),
      feedbackId: id,
      parentCommentId: body.parentCommentId || null,
      body: body.body,
      authorUserId: session?.user?.id || null,
      authorSessionId: anonSessionId,
      authorName: session?.user ? session.user.name : body.authorName || null,
      authorEmail: session?.user ? session.user.email : body.authorEmail || null,
      isInternal: body.isInternal,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  // Increment comment count on the feedback item
  await db
    .update(feedback)
    .set({ commentCount: sql`${feedback.commentCount} + 1`, updatedAt: now })
    .where(eq(feedback.id, id))

  // Fetch author info for the response
  let author = null
  if (session?.user) {
    const [authorUser] = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1)
    author = authorUser || null
  }

  // Notify subscribers about the new public comment (fire-and-forget, skip internal notes)
  if (!created.isInternal) {
    const commenterName = created.authorName || (author?.name) || 'Someone'
    db.select()
      .from(feedbackSubscription)
      .where(eq(feedbackSubscription.feedbackId, id))
      .then((subscribers) => {
        const baseUrl = process.env.BETTER_AUTH_URL || 'http://localhost:3000'
        for (const sub of subscribers) {
          // Don't email the commenter about their own comment
          if (sub.email === created.authorEmail) continue
          const unsubscribeUrl = `${baseUrl}/api/feedback/${id}/unsubscribe?token=${sub.token}`
          sendNewCommentNotificationEmail({
            to: sub.email,
            feedbackTitle: fb.title,
            commenterName,
            commentBody: created.body,
            boardUrl: baseUrl,
            unsubscribeUrl,
          }).catch((err) => console.error('Failed to send comment notification:', err))
        }
      })
      .catch((err) => console.error('Failed to fetch subscribers for comment notification:', err))
  }

  setResponseStatus(event, 201)
  return createSuccessResponse({
    ...created,
    author,
  })
})
