/**
 * @openapi
 * /api/dashboard/stats:
 *   get:
 *     tags: [Projects]
 *     summary: Active project stats
 *     description: >
 *       Feedback counts by status group, product count, member count and the most recent feedback for the active project. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *       The active project is the one stored on the session or API key (see POST /api/projects/active), or the one named by the `X-Veerify-Project` header.
 *     operationId: getDashboardStats
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     responses:
 *       200: { description: "Stats: totalFeedback, openFeedback, inProgressFeedback, completedFeedback, productCount, memberCount, recentFeedback" }
 *       401: { description: "Not authenticated" }
 *       409: { description: "The caller can open no project; create one first" }
 */
import { requireAuthWithResolvedProject } from '~/server/utils/project-context'
import { createSuccessResponse } from '~/server/utils/response'
import { getWorkspaceStatsForProject } from '~/server/utils/dashboard-bootstrap'

export default defineEventHandler(async (event) => {
  const { activeProject } = await requireAuthWithResolvedProject(event)
  const stats = await getWorkspaceStatsForProject(activeProject.id)

  return createSuccessResponse(stats)
})
