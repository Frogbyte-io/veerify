/**
 * @openapi
 * /api/marketing/projects/{projectId}/site:
 *   get:
 *     tags: [Marketing]
 *     summary: Get the marketing site and its verification instructions
 *     description: >
 *       Requires Marketing to be enabled for the team and the product. Returns
 *       `site: null` until a site is added. `canManage` is true for team admins.
 *     operationId: getMarketingSite
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Site, verification instructions and whether the caller can manage it }
 *       403: { description: Not a team member, or Marketing is off }
 *       404: { description: Product not found }
 */
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { createSuccessResponse } from '~/server/utils/response'
import {
  findMarketingSite,
  isTeamAdminOf,
  requireRouteParam,
  serializeSiteWithVerification,
} from '~/server/utils/marketing-site'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouteParam(event, 'projectId')
  const { teamId } = await requireMarketingAccess(projectId, session.user.id)

  const [site, canManage] = await Promise.all([findMarketingSite(projectId), isTeamAdminOf(teamId, session.user.id)])
  return createSuccessResponse(serializeSiteWithVerification(site, canManage))
})
