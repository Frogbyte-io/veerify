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
