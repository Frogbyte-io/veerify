/**
 * @openapi
 * /api/marketing/teams/{teamId}/data-consent:
 *   get:
 *     tags: [Marketing]
 *     summary: Whether feedback and support text may be sent to the team's AI provider
 *     description: Both sources are off until a team admin turns them on.
 *     operationId: getMarketingDataConsent
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Consent flags, who consented and when, and canManage }
 *       403: { description: Not a member of this team }
 */
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { createSuccessResponse } from '~/server/utils/response'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { getConsentSummary, requireConsentMember } from '~/server/services/marketing/customer-language/consent'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const teamId = requireRouteParam(event, 'teamId')
  const membership = await requireConsentMember(teamId, session.user.id)

  return createSuccessResponse({ ...(await getConsentSummary(teamId)), canManage: membership.role === 'admin' })
})
