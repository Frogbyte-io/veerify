/**
 * @openapi
 * /api/v1/feedback:
 *   post:
 *     tags: [App API]
 *     summary: Submit feedback from an app
 *     description: Creates feedback in the project the app key belongs to. Authenticate with a project app key as a Bearer token.
 *     operationId: submitAppFeedback
 *     security:
 *       - appKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, description]
 *             properties:
 *               type: { type: string, enum: [bug, feature] }
 *               description: { type: string, minLength: 1, maxLength: 2000 }
 *               appVersion: { type: string, maxLength: 64 }
 *               os: { type: string, maxLength: 64 }
 *               osVersion: { type: string, maxLength: 64 }
 *     responses:
 *       201: { description: Feedback created }
 *       400: { description: Validation failed }
 *       401: { description: "Missing, unknown, or revoked app key" }
 *       429: { description: Rate limit exceeded }
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedback, projectApiKey } from '~/server/database/schema/feedback'
import { deriveTitle, requireAppKey, toFeedbackType } from '~/server/utils/app-keys'
import { createLogger } from '~/server/utils/logger'
import { notifyProjectTeam } from '~/server/utils/notifications'
import { rateLimits, requireRateLimit } from '~/server/utils/rate-limit'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'

const logger = createLogger('app-feedback')

const clientField = z.string().trim().max(64).nullish()

const appFeedbackSchema = z.object({
  type: z.enum(['bug', 'feature']),
  description: z.string().trim().min(1, 'Description is required').max(2000, 'Description too long'),
  appVersion: clientField,
  os: clientField,
  osVersion: clientField,
})

export default defineEventHandler(async (event) => {
  await requireRateLimit(event, { ...rateLimits.strict, identifier: 'app-feedback-ip' })

  const key = await requireAppKey(event)
  await requireRateLimit(event, {
    maxRequests: 200,
    windowSeconds: 3600,
    identifier: 'app-feedback-key',
    subject: key.id,
  })

  const body = await validateBody(event, appFeedbackSchema)

  const client: Record<string, string> = {}
  if (body.appVersion) client.appVersion = body.appVersion
  if (body.os) client.os = body.os
  if (body.osVersion) client.osVersion = body.osVersion

  const id = crypto.randomUUID()
  const title = deriveTitle(body.description)
  const authorName = `${key.name} user`
  const now = new Date()

  await db.insert(feedback).values({
    id,
    projectId: key.projectId,
    title,
    body: body.description,
    status: 'open',
    authorUserId: null,
    authorSessionId: null,
    authorName,
    authorEmail: null,
    voteCount: 0,
    commentCount: 0,
    isPinned: false,
    isLocked: false,
    apiKeyId: key.id,
    sourceLabel: key.name,
    metadata: {
      feedbackType: toFeedbackType(body.type),
      ...(Object.keys(client).length > 0 ? { client } : {}),
    },
    createdAt: now,
    updatedAt: now,
  })

  // Fire-and-forget: a failed bookkeeping write must not fail the submission.
  Promise.resolve(db.update(projectApiKey).set({ lastUsedAt: now }).where(eq(projectApiKey.id, key.id))).catch((err) =>
    logger.error('Failed to update app key lastUsedAt', {
      keyId: key.id,
      error: err instanceof Error ? err.message : err,
    })
  )

  notifyProjectTeam(key.projectId, null, {
    type: 'new_feedback',
    title: `New feedback: "${title}"`,
    body: `Added from ${key.name}`,
    link: `/feedback?id=${id}`,
    feedbackId: id,
    actorName: authorName,
  })

  setResponseStatus(event, 201)
  return createSuccessResponse({ id })
})
