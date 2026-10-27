/**
 * @openapi
 * /api/projects/{slug}/members/{userId}:
 *   patch:
 *     tags: [Projects]
 *     summary: Change project member role
 *     description: >
 *       Sets a member's project role. Project admins only (organization owners and admins count as project admins). The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: updateProjectMember
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role: { type: string, enum: [admin, member] }
 *     responses:
 *       200: { description: "The updated member entry" }
 *       400: { description: "Validation failed" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not a project admin" }
 *       404: { description: "Project not found, or user is not a workspace member" }
 *       409: { description: "Workspace owners and admins cannot be assigned" }
 */
import { z } from 'zod'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { requireAssignableUser, upsertProjectMember } from '~/server/utils/project-members'
import { listProjectMembers } from '~/server/utils/project-summary'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'

const updateMemberSchema = z.object({
  role: z.enum(['admin', 'member']),
})

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const userId = getRouterParam(event, 'userId') ?? ''
  const body = await validateBody(event, updateMemberSchema)

  await requireAssignableUser(project, userId)
  await upsertProjectMember(project.id, userId, body.role)

  const entry = (await listProjectMembers(project)).find((m) => m.userId === userId)
  return createSuccessResponse(entry ?? null)
})
