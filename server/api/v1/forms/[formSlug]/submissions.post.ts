/**
 * @openapi
 * /api/v1/forms/{formSlug}/submissions:
 *   post:
 *     tags: [App API]
 *     summary: Submit a website form (server to server)
 *     description: >
 *       Files the submission into the form's inbox as a new conversation from
 *       the submitter, exactly like an inbound email: the contact is found or
 *       created by email, SLA, auto-reply and automation rules apply, and agent
 *       replies are emailed to the submitter. Authenticate with a project
 *       server key (`Authorization: Bearer vfy_srv_...`) from your backend;
 *       never expose it to a browser. Send `Idempotency-Key` to make retries
 *       safe. See docs/forms-api.md.
 *     operationId: submitSupportForm
 *     security:
 *       - appKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: formSlug
 *         required: true
 *         schema: { type: string }
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema: { type: string, maxLength: 255 }
 *         description: "A retry with the same key and body returns the first result (200, header Idempotent-Replayed: true) instead of filing again."
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fields]
 *             additionalProperties: false
 *             properties:
 *               fields:
 *                 type: object
 *                 description: Field key to value. Strings for text, email, textarea and select (the option value); booleans for checkboxes.
 *                 additionalProperties: true
 *               metadata:
 *                 type: object
 *                 additionalProperties: false
 *                 properties:
 *                   pageUrl: { type: string, maxLength: 2048 }
 *                   locale: { type: string, maxLength: 35 }
 *                   brand: { type: string, maxLength: 120 }
 *                   orderNumber: { type: string, maxLength: 120 }
 *                   clientIp: { type: string, maxLength: 64, description: "The visitor's IP; also rate-limits submissions per visitor" }
 *                   userAgent: { type: string, maxLength: 2048 }
 *                   referrer: { type: string, maxLength: 2048 }
 *                   extra: { type: object, additionalProperties: { type: string }, maxProperties: 20 }
 *     responses:
 *       201: { description: "Filed. `data: { id, conversationId }`" }
 *       200: { description: "Idempotent replay of an earlier request with the same key" }
 *       400: { description: "Invalid JSON, unknown or invalid fields (`error.details` lists them), or a bad Idempotency-Key" }
 *       401: { description: "Missing, unknown or revoked server key" }
 *       403: { description: "Form disabled (`FORM_DISABLED`) or its inbox is off (`INBOX_UNAVAILABLE`)" }
 *       404: { description: "No form with that slug in the key's project (`FORM_NOT_FOUND`)" }
 *       413: { description: Body larger than 64 KiB }
 *       422: { description: "Idempotency-Key reused with a different body (`IDEMPOTENCY_KEY_REUSED`)" }
 *       429: { description: Rate limit exceeded }
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { projectApiKey } from '~/server/database/schema/feedback'
import { requireServerKey } from '~/server/utils/app-keys'
import { createLogger } from '~/server/utils/logger'
import { requireRateLimit } from '~/server/utils/rate-limit'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { readJsonBodyWithLimit } from '~/server/utils/json-body-limit'
import {
  cleanMetadata,
  findFormBySlug,
  formNotFound,
  hashSubmissionRequest,
  readIdempotencyKey,
  submissionBodySchema,
  submitForm,
} from '~/server/services/support-forms/submit'
import { FORM_LIMITS } from '~/lib/support-forms'
import { FORM_API_IP_LIMIT, FORM_API_KEY_LIMIT, FORM_API_VISITOR_LIMIT } from '~/server/services/support-forms/limits'

const logger = createLogger('support-forms-api')

export default defineEventHandler(async (event) => {
  await requireRateLimit(event, FORM_API_IP_LIMIT)
  const key = await requireServerKey(event)
  await requireRateLimit(event, { ...FORM_API_KEY_LIMIT, subject: key.id })

  const form = await findFormBySlug(key.projectId, getRouterParam(event, 'formSlug') ?? '')
  if (!form) throw formNotFound()

  const raw = await readJsonBodyWithLimit(event, FORM_LIMITS.bodyBytes)
  const parsed = submissionBodySchema.safeParse(raw)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Validation failed',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Request validation failed', parsed.error.issues),
    })
  }
  const idempotencyKey = readIdempotencyKey(getRequestHeader(event, 'idempotency-key'))
  const metadata = cleanMetadata(parsed.data.metadata)

  if (metadata.clientIp) {
    await requireRateLimit(event, { ...FORM_API_VISITOR_LIMIT, subject: `${form.id}:${metadata.clientIp}` })
  }

  const result = await submitForm({
    form,
    fields: parsed.data.fields,
    metadata,
    source: 'api',
    apiKeyId: key.id,
    idempotencyKey,
    requestHash: hashSubmissionRequest(parsed.data),
  })

  // Fire-and-forget: a failed bookkeeping write must not fail the submission.
  Promise.resolve(db.update(projectApiKey).set({ lastUsedAt: new Date() }).where(eq(projectApiKey.id, key.id))).catch(
    (error) =>
      logger.error('Failed to update server key lastUsedAt', {
        keyId: key.id,
        error: error instanceof Error ? error.message : error,
      })
  )

  if (result.replayed) {
    setResponseHeader(event, 'Idempotent-Replayed', 'true')
    setResponseStatus(event, 200)
  } else {
    setResponseStatus(event, 201)
  }
  return createSuccessResponse({ id: result.id, conversationId: result.conversationId })
})
