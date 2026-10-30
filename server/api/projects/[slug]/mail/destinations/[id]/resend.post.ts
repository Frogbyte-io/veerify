/**
 * @openapi
 * /api/projects/{slug}/mail/destinations/{id}/resend:
 *   post:
 *     tags: [Projects]
 *     summary: Resend a forward destination's confirmation email
 *     description: >
 *       Asks Frogmail to send the confirmation email again to a forward destination that is pending, revoked or
 *       suspended, and returns the refreshed destination. Project admins only. A verified destination is 409
 *       (CONFLICT); the provider's rate limit is 429 with a `Retry-After` header. Requires authentication: a session
 *       cookie or a personal API key.
 *     operationId: resendMailForwardDestination
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - { in: path, name: slug, required: true, schema: { type: string } }
 *       - { in: path, name: id, required: true, description: "Destination id (ProjectMailAddressForward.id)", schema: { type: string } }
 *     responses:
 *       200: { description: "{ destination: ProjectMailAddressForward }" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Not a project admin" }
 *       404: { description: "Project or destination not found" }
 *       409: { description: "The destination is already confirmed, or forwarding is unavailable" }
 *       429: { description: "Rate limited; see Retry-After" }
 */
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { createSuccessResponse } from '~/server/utils/response'
import { resendForwardDestination, toDestinationItem } from '~/server/utils/mail-destination-actions'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const row = await resendForwardDestination(event, project.id, getRouterParam(event, 'id') ?? '')
  return createSuccessResponse({ destination: toDestinationItem(row) })
})
