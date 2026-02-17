import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { getOrCreateAnonSession } from '~/server/utils/anonymous-session'
import { validateBody } from '~/server/utils/validation'
import { requirePublicProject, requireProjectAccess } from '~/server/utils/project-access'
import { db } from '~/server/database/drizzle'
import { feedback, project, feedbackCategory, vote } from '~/server/database/schema/feedback'
import { sendFeedbackConfirmationEmail } from '~/lib/email'

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

  // For authenticated users submitting to private projects, verify team access
  if (session?.user) {
    await requireProjectAccess(body.projectId, session.user.id)
  } else {
    // Anonymous user - project must be public
    await requirePublicProject(body.projectId)
  }

  // Fetch project for category validation (already verified access above)
  const [proj] = await db.select().from(project).where(eq(project.id, body.projectId)).limit(1)
  if (!proj) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Project not found'),
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

  // For anonymous users, get or create an anonymous session
  let anonSessionId: string | null = null
  if (!session?.user) {
    const anonSession = await getOrCreateAnonSession(event)
    anonSessionId = anonSession.id
  }

  // Generate a tokenized edit link for the submitter
  const editToken = crypto.randomUUID()
  const editTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

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
      authorSessionId: anonSessionId,
      authorName: session?.user ? session.user.name : body.authorName || null,
      authorEmail: session?.user ? session.user.email : body.authorEmail || null,
      voteCount: 1,
      commentCount: 0,
      isPinned: false,
      isLocked: false,
      metadata: { editToken, editTokenExpiry },
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

  // Send confirmation email if the submitter provided an email address
  const recipientEmail = session?.user ? session.user.email : body.authorEmail
  const recipientName = session?.user ? session.user.name : body.authorName

  if (recipientEmail && recipientName) {
    const origin = getRequestURL(event).origin
    const editUrl = `${origin}/feedback/${created.id}/edit?token=${editToken}`

    sendFeedbackConfirmationEmail({
      to: recipientEmail,
      authorName: recipientName,
      feedbackTitle: created.title,
      projectName: proj.name,
      editUrl,
    }).catch((err) => console.error('Failed to send feedback confirmation email:', err))
  }

  setResponseStatus(event, 201)
  return createSuccessResponse(created)
})
