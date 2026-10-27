/**
 * @openapi
 * /api/projects/{slug}/members:
 *   get:
 *     tags: [Projects]
 *     summary: List project members
 *     description: >
 *       Lists who can open the project, with the project's access mode. The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: listProjectMembers
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         description: "Project slug"
 *         schema: { type: string }
 *     responses:
 *       200: { description: "{ accessMode: workspace | restricted, members: [...] }" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "No access to the project" }
 *       404: { description: "Project not found in the active workspace" }
 */
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { listProjectMembers } from '~/server/utils/project-summary'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '')
  const members = await listProjectMembers(project)

  return createSuccessResponse({
    accessMode: project.accessMode === 'restricted' ? 'restricted' : 'workspace',
    members,
  })
})
