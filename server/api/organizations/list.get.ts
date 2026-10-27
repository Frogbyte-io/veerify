/**
 * @openapi
 * /api/organizations/list:
 *   get:
 *     tags: [Organizations]
 *     summary: List my organizations
 *     description: >
 *       Lists the organizations (workspaces) the caller belongs to, with the caller's role in each, ordered by name. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: listMyOrganizations
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     responses:
 *       200: { description: "Array of { id, name, slug, logo, role }" }
 *       401: { description: "Not authenticated" }
 */
import { requireAuth } from '~/server/utils/auth-middleware'
import { listOrganizationsForUser } from '~/server/utils/dashboard-bootstrap'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  return createSuccessResponse(await listOrganizationsForUser(session.user.id))
})
