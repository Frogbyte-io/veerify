/**
 * @openapi
 * /api/projects/active:
 *   get:
 *     tags: [Projects]
 *     summary: Get active project
 *     description: >
 *       Returns the caller's active project with its organization, products and resolved module flags,
 *       plus `scope` (`all` while working in All projects, where `project` is the last single project),
 *       `projects` (every project the caller can open in the organization, with colour/initials and tool
 *       switches) and `allProjectsAvailable`. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: getActiveProject
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     responses:
 *       200: { description: "Active project context: project (with settings), organization, products, modules" }
 *       401: { description: "Not authenticated" }
 *       409: { description: "The caller can open no project; create one first" }
 */
import { requireAuthWithProjectScope } from '~/server/utils/project-context'
import { buildActiveProjectContext } from '~/server/utils/project-summary'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { session, activeProject, scope } = await requireAuthWithProjectScope(event)
  return createSuccessResponse(await buildActiveProjectContext(activeProject, session.user.id, scope))
})
