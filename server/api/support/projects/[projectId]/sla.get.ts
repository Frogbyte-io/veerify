/**
 * @openapi
 * /api/support/projects/{projectId}/sla:
 *   get:
 *     tags: [Support]
 *     summary: Read business-hours and SLA policy settings
 *     operationId: getSupportSlaSettings
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: SLA settings }
 *       403: { description: Not a member of the project }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireProjectAccess } from '~/server/utils/project-access'
import { loadSlaSettings } from '~/server/utils/sla-settings'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  await requireProjectAccess(projectId, session.user.id)
  return createSuccessResponse(await loadSlaSettings(projectId))
})
