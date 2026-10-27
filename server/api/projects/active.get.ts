/**
 * @openapi
 * /api/projects/active:
 *   get:
 *     tags: [Projects]
 *     summary: Get active project
 *     description: >
 *       Returns the caller's active project with its organization, products and resolved module flags. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: getActiveProject
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     responses:
 *       200: { description: "Active project context: project (with settings), organization, products, modules" }
 *       401: { description: "Not authenticated" }
 *       409: { description: "The caller can open no project; create one first" }
 */
import { requireAuthWithResolvedProject } from '~/server/utils/project-context'
import { buildActiveProjectContext } from '~/server/utils/project-summary'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { session, activeProject } = await requireAuthWithResolvedProject(event)
  return createSuccessResponse(await buildActiveProjectContext(activeProject, session.user.id))
})
