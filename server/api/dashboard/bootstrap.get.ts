/**
 * @openapi
 * /api/dashboard/bootstrap:
 *   get:
 *     tags: [Projects]
 *     summary: Dashboard bootstrap
 *     description: >
 *       Returns everything the dashboard needs in one call: the session, the project context (organizations, active organization, accessible projects, active project with products and module flags), workspace stats for the active project, a personal submissions summary and the unread notification count. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *       With no accessible project, `workspace` is null and `projectContext` describes the organization the first project will be created in.
 *     operationId: getDashboardBootstrap
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     responses:
 *       200: { description: "Bootstrap payload: session, projectContext, workspace (stats or null), personal, notifications.unreadCount" }
 *       401: { description: "Not authenticated" }
 */
import { requireAuth } from '~/server/utils/auth-middleware'
import { getDashboardBootstrapData } from '~/server/utils/dashboard-bootstrap'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const bootstrap = await getDashboardBootstrapData(session)

  return createSuccessResponse(bootstrap)
})
