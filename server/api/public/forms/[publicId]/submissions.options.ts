/**
 * @openapi
 * /api/public/forms/{publicId}/submissions:
 *   options:
 *     tags: [Public]
 *     summary: CORS preflight for browser form submissions
 *     description: Grants CORS (POST, Content-Type, Idempotency-Key) to the form's allowed origins only.
 *     operationId: preflightSupportFormFromBrowser
 *     security: []
 *     parameters:
 *       - in: path
 *         name: publicId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204: { description: "Preflight answered; CORS headers only for an allowed origin" }
 */

/**
 * CORS preflight for the browser form endpoint. Grants only the form's
 * allowed origins; anything else gets 204 without CORS headers, which the
 * browser treats as a refusal.
 */
import { findFormByPublicId } from '~/server/services/support-forms/submit'
import { browserOriginAllowed, setFormCorsHeaders } from '~/server/services/support-forms/browser'

export default defineEventHandler(async (event) => {
  const origin = getRequestHeader(event, 'origin') ?? null
  const form = await findFormByPublicId(getRouterParam(event, 'publicId') ?? '')
  if (form?.browserSubmissionsEnabled && browserOriginAllowed(form, origin)) {
    setFormCorsHeaders(event, origin as string)
  }
  setResponseStatus(event, 204)
  return ''
})
