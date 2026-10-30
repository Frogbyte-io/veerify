/**
 * @openapi
 * /api/projects/{slug}/mail/destinations/{id}:
 *   delete:
 *     tags: [Projects]
 *     summary: Revoke a forward destination
 *     description: >
 *       Revokes a forward destination at Frogmail: mail to every address that forwards there stops being forwarded
 *       until the recipient confirms again (Resend). The destination stays in the address's forward list with status
 *       `revoked`. Project admins only. The provider's rate limit is 429 with a `Retry-After` header. Requires
 *       authentication: a session cookie or a personal API key.
 *     operationId: revokeMailForwardDestination
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
 *       409: { description: "Forwarding is unavailable" }
 *       429: { description: "Rate limited; see Retry-After" }
 */
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { createSuccessResponse } from '~/server/utils/response'
import { revokeForwardDestination, toDestinationItem } from '~/server/utils/mail-destination-actions'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const row = await revokeForwardDestination(event, project.id, getRouterParam(event, 'id') ?? '')
  return createSuccessResponse({ destination: toDestinationItem(row) })
})
