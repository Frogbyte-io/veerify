/**
 * @openapi
 * /api/projects/{slug}:
 *   delete:
 *     tags: [Projects]
 *     summary: Delete project
 *     description: >
 *       Permanently deletes the project and its data. Organization owners and admins only. The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: deleteProject
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
 *       200: { description: "{ id, deleted: true }" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not an organization owner or admin" }
 *       404: { description: "Project not found in the active workspace" }
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project } from '~/server/database/schema/feedback'
import { session as sessionTable } from '~/server/database/schema/auth'
import { revokeGscTokensForProject } from '~/server/services/marketing/search/connection'
import { requireOrganizationAdmin } from '~/server/utils/project-access'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const {
    session,
    project: proj,
    organizationId,
  } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '')
  await requireOrganizationAdmin(organizationId, session.user.id)

  // Revoke Google tokens while the connection rows still exist; best effort, never throws
  await revokeGscTokensForProject(proj.id)

  await db.transaction(async (tx) => {
    // Sessions pointing at the project fall back to another accessible project on the next request.
    await tx.update(sessionTable).set({ activeProjectId: null }).where(eq(sessionTable.activeProjectId, proj.id))
    await tx.delete(project).where(eq(project.id, proj.id))
  })

  return createSuccessResponse({ id: proj.id, deleted: true })
})
