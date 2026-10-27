/**
 * @openapi
 * /api/projects/{slug}/members:
 *   post:
 *     tags: [Projects]
 *     summary: Add project member
 *     description: >
 *       Adds a workspace member to the project, or updates their role when already added. Workspace owners and admins already administer every project and are rejected. Project admins only (organization owners and admins count as project admins). The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: addProjectMember
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         description: "Project slug"
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId]
 *             properties:
 *               userId: { type: string, minLength: 1 }
 *               role: { type: string, enum: [admin, member], default: member }
 *     responses:
 *       201: { description: "The member entry" }
 *       400: { description: "Validation failed" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not a project admin" }
 *       404: { description: "Project not found in the active workspace" }
 *       409: { description: "Workspace owners and admins cannot be assigned" }
 */
import { z } from 'zod'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { requireAssignableUser, upsertProjectMember } from '~/server/utils/project-members'
import { listProjectMembers } from '~/server/utils/project-summary'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'

const addMemberSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  role: z.enum(['admin', 'member']).default('member'),
})

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const body = await validateBody(event, addMemberSchema)

  await requireAssignableUser(project, body.userId)
  await upsertProjectMember(project.id, body.userId, body.role)

  const entry = (await listProjectMembers(project)).find((m) => m.userId === body.userId)
  setResponseStatus(event, 201)
  return createSuccessResponse(entry ?? null)
})
