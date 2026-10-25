/**
 * @openapi
 * /api/public/o/{orgSlug}/{projectSlug}/products/{productSlug}/feedback:
 *   post:
 *     tags: [Public]
 *     summary: Submit feedback to a public product board
 *     operationId: submitPublicProductFeedback
 *     parameters:
 *       - { in: path, name: orgSlug, required: true, schema: { type: string } }
 *       - { in: path, name: projectSlug, required: true, schema: { type: string } }
 *       - { in: path, name: productSlug, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, body]
 *             properties:
 *               title: { type: string, maxLength: 200 }
 *               body: { type: string, maxLength: 5000 }
 *               categoryId: { type: string, nullable: true }
 *               authorName: { type: string }
 *               authorEmail: { type: string }
 *               attachmentIds: { type: array, items: { type: string } }
 *     responses:
 *       201: { description: Feedback created }
 *       400: { description: Validation failed }
 *       403: { description: Project is not public }
 *       404: { description: Workspace, project or product not found }
 */
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { getOrCreateAnonSession } from '~/server/utils/anonymous-session'
import { validateBody, optionalTrimmedEmail, optionalTrimmedString } from '~/server/utils/validation'
import { resolvePublicProject, requirePublicProduct } from '~/server/utils/project-access'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory, vote } from '~/server/database/schema/feedback'
import { createAutomaticFeedbackLink } from '~/server/utils/support-auto-link'
import { FEEDBACK_ATTACHMENT_MAX_COUNT } from '~/server/utils/feedback-attachments'
import { attachUploadsToFeedback } from '~/server/utils/feedback-attachment-access'

const submitFeedbackSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  body: z.string().min(1, 'Description is required').max(5000, 'Description too long'),
  categoryId: z.string().optional().nullable(),
  authorName: optionalTrimmedString(100, 'Name too long'),
  authorEmail: optionalTrimmedEmail('Invalid email'),
  // Ids of finalized, unattached uploads from POST /api/feedback-attachments/presign
  attachmentIds: z.array(z.string().min(1)).max(FEEDBACK_ATTACHMENT_MAX_COUNT).optional(),
})

export default defineEventHandler(async (event) => {
  await requireRateLimit(event, { ...rateLimits.strict, identifier: 'public-feedback-submit' })

  const orgSlug = getRouterParam(event, 'orgSlug')
  const projectSlug = getRouterParam(event, 'projectSlug')
  const productSlug = getRouterParam(event, 'productSlug')

  const session = await optionalAuth(event)
  const body = await validateBody(event, submitFeedbackSchema)

  const { project: proj } = await resolvePublicProject(orgSlug!, projectSlug!)
  const prod = await requirePublicProduct(proj, productSlug!)

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
  const created = await db.transaction(async (tx) => {
    if (body.categoryId) {
      const [cat] = await tx
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

    const [createdFeedback] = await tx
      .insert(feedback)
      .values({
        id: crypto.randomUUID(),
        projectId: proj.id,
        productId: prod.id,
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

    // Auto-upvote by the submitter so the item appears ranked without a second click.
    await tx.insert(vote).values({
      id: crypto.randomUUID(),
      feedbackId: createdFeedback.id,
      voterUserId: session?.user?.id || null,
      voterSessionId: anonSessionId,
      createdAt: now,
    })

    if (session?.user) {
      await createAutomaticFeedbackLink(tx, {
        projectId: proj.id,
        feedbackId: createdFeedback.id,
        authorUserId: session.user.id,
        createdAt: now,
      })
    }

    if (body.attachmentIds?.length) {
      await attachUploadsToFeedback(tx, {
        attachmentIds: body.attachmentIds,
        feedbackId: createdFeedback.id,
        projectId: proj.id,
        actor: { userId: session?.user?.id ?? null, anonSessionId },
        now,
      })
    }

    return createdFeedback
  })

  setResponseStatus(event, 201)
  return createSuccessResponse({
    id: created.id,
    productId: created.productId,
    title: created.title,
    status: created.status,
    createdAt: created.createdAt,
  })
})
