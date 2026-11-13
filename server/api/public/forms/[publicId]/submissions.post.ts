/**
 * @openapi
 * /api/public/forms/{publicId}/submissions:
 *   post:
 *     tags: [Public]
 *     summary: Submit a website form from a browser
 *     description: >
 *       For sites without a backend. Off unless the form has browser
 *       submissions switched on, and accepted only from the form's allowed
 *       origins (checked against the `Origin` header; CORS is granted to those
 *       origins only). Rate limited per visitor IP, and per form for
 *       submissions that pass validation. The `_hp`
 *       honeypot must be empty: a filled one gets a normal-looking 201 and
 *       nothing is filed. Accepts JSON (`{ fields, metadata?: { pageUrl,
 *       locale }, _hp?, challengeToken? }`) or form-encoded fields (`_hp`,
 *       `_page_url`, `_locale`, `_challenge` reserved). Filed exactly like the
 *       server API. See docs/forms-api.md.
 *     operationId: submitSupportFormFromBrowser
 *     security: []
 *     parameters:
 *       - in: path
 *         name: publicId
 *         required: true
 *         schema: { type: string }
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema: { type: string, maxLength: 255 }
 *     responses:
 *       201: { description: "Accepted. `data: { id }`" }
 *       200: { description: Idempotent replay }
 *       400: { description: Invalid body or fields }
 *       403: { description: "Origin not allowed (`ORIGIN_NOT_ALLOWED`), challenge failed (`CHALLENGE_FAILED`), form disabled or inbox off" }
 *       404: { description: "Unknown form, or browser submissions are off (`FORM_NOT_FOUND`)" }
 *       413: { description: Body larger than 64 KiB }
 *       415: { description: Unsupported content type }
 *       422: { description: Idempotency-Key reused with a different body }
 *       429: { description: Rate limit exceeded }
 */
import { randomUUID } from 'node:crypto'
import { createLogger } from '~/server/utils/logger'
import { getClientIp, requireRateLimit } from '~/server/utils/rate-limit'
import { createErrorResponse, createSuccessResponse } from '~/server/utils/response'
import {
  cleanMetadata,
  findFormByPublicId,
  formNotFound,
  hashSubmissionRequest,
  readIdempotencyKey,
  submitForm,
} from '~/server/services/support-forms/submit'
import {
  browserOriginAllowed,
  originNotAllowed,
  readBrowserSubmission,
  setFormCorsHeaders,
} from '~/server/services/support-forms/browser'
import { verifyFormChallenge } from '~/server/services/support-forms/challenge'
import { FORM_BROWSER_FORM_LIMIT, FORM_BROWSER_VISITOR_LIMIT } from '~/server/services/support-forms/limits'

const logger = createLogger('support-forms-browser')

export default defineEventHandler(async (event) => {
  const form = await findFormByPublicId(getRouterParam(event, 'publicId') ?? '')
  // Indistinguishable from an unknown id, so a disabled browser path reveals nothing.
  if (!form || !form.browserSubmissionsEnabled) throw formNotFound()

  const origin = getRequestHeader(event, 'origin') ?? null
  if (!browserOriginAllowed(form, origin)) throw originNotAllowed()
  setFormCorsHeaders(event, origin as string)

  const clientIp = getClientIp(event) ?? null
  await requireRateLimit(event, { ...FORM_BROWSER_VISITOR_LIMIT, subject: `${form.id}:${clientIp ?? 'unknown'}` })
  const submission = await readBrowserSubmission(event, form)

  if (submission.honeypot.trim() !== '') {
    // Look accepted, so the bot learns nothing; file nothing.
    logger.info('Dropped a browser form submission that filled the honeypot', { formId: form.id })
    setResponseStatus(event, 201)
    return createSuccessResponse({ id: randomUUID() })
  }

  if (!(await verifyFormChallenge({ form, token: submission.challengeToken, clientIp }))) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse('CHALLENGE_FAILED', 'The bot check failed. Reload the page and try again.'),
    })
  }

  const idempotencyKey = readIdempotencyKey(getRequestHeader(event, 'idempotency-key'))
  const metadata = cleanMetadata({
    pageUrl: submission.pageUrl ?? getRequestHeader(event, 'referer') ?? undefined,
    locale: submission.locale ?? undefined,
    clientIp: clientIp ?? undefined,
    userAgent: getRequestHeader(event, 'user-agent')?.slice(0, 2048),
  })

  const result = await submitForm({
    form,
    fields: submission.fields,
    metadata,
    source: 'browser',
    apiKeyId: null,
    idempotencyKey,
    requestHash: hashSubmissionRequest({
      fields: submission.fields,
      pageUrl: submission.pageUrl,
      locale: submission.locale,
    }),
    // Charged only for submissions that would be filed, so junk cannot block real visitors.
    onAccepted: () => requireRateLimit(event, { ...FORM_BROWSER_FORM_LIMIT, subject: form.id }),
  })

  if (result.replayed) {
    setResponseHeader(event, 'Idempotent-Replayed', 'true')
    setResponseStatus(event, 200)
  } else {
    setResponseStatus(event, 201)
  }
  // The visitor gets a reference, not internal conversation ids.
  return createSuccessResponse({ id: result.id })
})
