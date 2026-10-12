/**
 * @openapi
 * /api/feedback-attachments/presign:
 *   post:
 *     tags: [Feedback]
 *     summary: Get an upload target for a feedback attachment
 *     description: >
 *       Pass `projectId` to upload before the feedback exists (the returned
 *       attachment id is then sent in `attachmentIds` of `POST /api/feedback`), or
 *       `feedbackId` to add a file to an existing item (author or team member).
 *       Anonymous callers are accepted only for public projects. Enforces the
 *       type allowlist, the 10 MB cap and the 5 files per feedback limit.
 *     operationId: presignFeedbackAttachment
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fileName, contentType, sizeBytes]
 *             properties:
 *               projectId: { type: string }
 *               feedbackId: { type: string }
 *               fileName: { type: string }
 *               contentType: { type: string }
 *               sizeBytes: { type: integer }
 *     responses:
 *       200: { description: Upload target }
 *       400: { description: Unsupported type, too large, or too many attachments }
 *       403: { description: Not allowed to attach files here }
 *       404: { description: Project or feedback not found }
 *       429: { description: Rate limited }
 */
import { z } from 'zod'
import { createSuccessResponse } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { getOrCreateAnonSession } from '~/server/utils/anonymous-session'
import { requirePublicProject, requireProjectAccess } from '~/server/utils/project-access'
import { requireRateLimit, rateLimits } from '~/server/utils/rate-limit'
import { validateBody } from '~/server/utils/validation'
import { getStorageProvider } from '~/server/utils/storage'
import { db } from '~/server/database/drizzle'
import { feedbackAttachment } from '~/server/database/schema/feedback'
import {
  buildFeedbackAttachmentKey,
  FEEDBACK_ATTACHMENT_MAX_COUNT,
  FEEDBACK_ATTACHMENT_UPLOAD_EXPIRES_SECONDS,
  feedbackAttachmentError,
  sanitizeFeedbackAttachmentFilename,
  signFeedbackAttachmentUploadToken,
  validateFeedbackAttachmentRequest,
} from '~/server/utils/feedback-attachments'
import {
  countFeedbackAttachmentSlots,
  countUnattachedUploads,
  loadFeedbackAttachmentContext,
  resolveAttachmentActor,
  type AttachmentActor,
} from '~/server/utils/feedback-attachment-access'

const bodySchema = z
  .object({
    projectId: z.string().min(1).optional(),
    feedbackId: z.string().min(1).optional(),
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().min(1).max(100),
    sizeBytes: z.number().int().positive(),
  })
  .refine((value) => Boolean(value.projectId) !== Boolean(value.feedbackId), {
    message: 'Provide exactly one of projectId or feedbackId',
  })

// Per-file requests, so allow a full submission's worth of files plus a retry,
// while staying much tighter for anonymous callers than for signed-in ones.
const anonLimit = { maxRequests: FEEDBACK_ATTACHMENT_MAX_COUNT * 4, windowSeconds: 60 }

export default defineEventHandler(async (event) => {
  const session = await optionalAuth(event)
  await requireRateLimit(event, {
    ...(session?.user ? rateLimits.standard : anonLimit),
    identifier: session?.user ? 'feedback-attachment-presign-auth' : 'feedback-attachment-presign-anon',
  })

  const body = await validateBody(event, bodySchema)
  const declaredType = validateFeedbackAttachmentRequest(body.fileName, body.contentType, body.sizeBytes)
  const fileName = sanitizeFeedbackAttachmentFilename(body.fileName)

  let projectId: string
  let feedbackId: string | null = null
  let actor: AttachmentActor

  if (body.feedbackId) {
    // Add-later: author or team member of an existing item.
    const baseActor = await resolveAttachmentActor(event)
    const ctx = await loadFeedbackAttachmentContext(event, body.feedbackId, baseActor)
    if (!ctx.access.canView) feedbackAttachmentError(404, 'Feedback not found')
    if (!ctx.access.canUpload) feedbackAttachmentError(403, 'You cannot add attachments to this feedback')
    if ((await countFeedbackAttachmentSlots(body.feedbackId)) >= FEEDBACK_ATTACHMENT_MAX_COUNT) {
      feedbackAttachmentError(400, `At most ${FEEDBACK_ATTACHMENT_MAX_COUNT} attachments are allowed per feedback`)
    }
    projectId = ctx.feedback.projectId
    feedbackId = body.feedbackId
    actor = baseActor
  } else {
    // Pre-create: same eligibility as feedback submission (POST /api/feedback for
    // team members, the public board endpoint for everyone on a public product).
    projectId = body.projectId!
    if (session?.user) {
      try {
        await requireProjectAccess(projectId, session.user.id)
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode !== 403) throw error
        await requirePublicProject(projectId)
      }
      actor = { userId: session.user.id, anonSessionId: null }
    } else {
      await requirePublicProject(projectId)
      const anon = await getOrCreateAnonSession(event)
      actor = { userId: null, anonSessionId: anon.id }
    }
    if ((await countUnattachedUploads(projectId, actor)) >= FEEDBACK_ATTACHMENT_MAX_COUNT * 2) {
      feedbackAttachmentError(429, 'Too many pending uploads. Submit your feedback or try again later.')
    }
  }

  const attachmentId = crypto.randomUUID()
  const storageKey = buildFeedbackAttachmentKey(projectId, attachmentId, fileName)
  const now = new Date()
  const expiresAtDate = new Date(now.getTime() + FEEDBACK_ATTACHMENT_UPLOAD_EXPIRES_SECONDS * 1000)

  await db.insert(feedbackAttachment).values({
    id: attachmentId,
    feedbackId,
    projectId,
    storageKey,
    fileName,
    requestedContentType: declaredType,
    requestedSizeBytes: body.sizeBytes,
    contentType: declaredType,
    sizeBytes: body.sizeBytes,
    kind: 'file',
    uploadedByUserId: actor.userId,
    uploadedBySessionId: actor.anonSessionId,
    status: 'pending',
    createdAt: now,
  })

  const storage = getStorageProvider()
  let uploadTarget: { uploadUrl: string; method: 'PUT'; headers: Record<string, string> }
  if (storage.directUploadConstraints === 'content-length-enforced') {
    uploadTarget = await storage.getPresignedUploadTarget(
      storageKey,
      declaredType,
      FEEDBACK_ATTACHMENT_UPLOAD_EXPIRES_SECONDS,
      { expectedSizeBytes: body.sizeBytes }
    )
  } else {
    const token = signFeedbackAttachmentUploadToken(attachmentId, expiresAtDate)
    uploadTarget = {
      uploadUrl: `/api/feedback-attachments/upload/${encodeURIComponent(token)}`,
      method: 'PUT',
      headers: { 'content-type': declaredType },
    }
  }

  return createSuccessResponse({
    attachmentId,
    fileName,
    contentType: declaredType,
    uploadUrl: uploadTarget.uploadUrl,
    method: uploadTarget.method,
    headers: uploadTarget.headers,
    expiresAt: expiresAtDate.toISOString(),
  })
})
