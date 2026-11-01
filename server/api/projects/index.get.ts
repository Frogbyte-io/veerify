/**
 * @openapi
 * /api/projects:
 *   get:
 *     tags: [Projects]
 *     summary: List projects
 *     description: >
 *       Lists the projects the caller can open in the active organization, each with its product count. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: listProjects
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     responses:
 *       200: { description: "Array of project summaries (id, name, slug, description, isPublic, accessMode, role, organizationId) plus productCount, identity (color, initials, logoUrl) and modules" }
 *       401: { description: "Not authenticated" }
 *       409: { description: "No active organization" }
 */
import { listAccessibleProjects } from '~/server/utils/project-access'
import { requireAuthWithOrganization } from '~/server/utils/project-context'
import { toScopeProjects } from '~/server/utils/project-summary'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { session, organizationId } = await requireAuthWithOrganization(event)
  const projects = await listAccessibleProjects(organizationId, session.user.id)
  return createSuccessResponse(await toScopeProjects(organizationId, projects))
})
