/**
 * @openapi
 * /api/public/o/{orgSlug}/{projectSlug}/viewer:
 *   get:
 *     tags: [Public]
 *     summary: The signed-in viewer's role on a public project
 *     description: >
 *       Lets the public site show admin affordances without exposing member
 *       lists. Anonymous callers get `{ isMember: false, role: null }`.
 *     operationId: getPublicProjectViewer
 *     parameters:
 *       - { in: path, name: orgSlug, required: true, schema: { type: string } }
 *       - { in: path, name: projectSlug, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "`{ isMember, role }`" }
 *       403: { description: Project is not public }
 *       404: { description: Workspace or project not found }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { resolvePublicProject, resolveProjectRole } from '~/server/utils/project-access'

export default defineEventHandler(async (event) => {
  const orgSlug = getRouterParam(event, 'orgSlug')
  const projectSlug = getRouterParam(event, 'projectSlug')

  const { project: proj } = await resolvePublicProject(orgSlug!, projectSlug!)
  const session = await optionalAuth(event)
  const role = session?.user ? await resolveProjectRole(proj, session.user.id) : null

  setHeader(event, 'Cache-Control', 'private, no-store')
  return createSuccessResponse({ isMember: role !== null, role })
})
