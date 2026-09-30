/**
 * @openapi
 * /api/support/teams/{teamId}/sla:
 *   get:
 *     tags: [Support]
 *     summary: Read business-hours and SLA policy settings
 *     operationId: getSupportSlaSettings
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: SLA settings }
 *       403: { description: Not a member of the team }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireTeamMembership } from '~/server/utils/support-access'
import { loadSlaSettings } from '~/server/utils/sla-settings'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const teamId = getRouterParam(event, 'teamId') as string
  await requireTeamMembership(teamId, session.user.id)
  return createSuccessResponse(await loadSlaSettings(teamId))
})
