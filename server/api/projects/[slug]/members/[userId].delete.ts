/**
 * @openapi
 * /api/projects/{slug}/members/{userId}:
 *   delete:
 *     tags: [Projects]
 *     summary: Remove project member
 *     description: >
 *       Removes a user's explicit project membership. Project admins only (organization owners and admins count as project admins). The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: removeProjectMember
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         description: "Project slug"
 *         schema: { type: string }
 *       - in: path
 *         name: userId
 *         required: true
 *         description: "User id of the workspace member"
 *         schema: { type: string }
 *     responses:
 *       200: { description: "{ userId, removed: true }" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not a project admin" }
 *       404: { description: "Project not found, user not a workspace member, or no explicit membership" }
 *       409: { description: "Workspace owners and admins cannot be removed" }
 */
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { deleteProjectMember, requireAssignableUser } from '~/server/utils/project-members'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const userId = getRouterParam(event, 'userId') ?? ''

  await requireAssignableUser(project, userId)
  const removed = await deleteProjectMember(project.id, userId)
  if (!removed) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'This person has no explicit project membership to remove'),
    })
  }

  return createSuccessResponse({ userId, removed: true })
})
