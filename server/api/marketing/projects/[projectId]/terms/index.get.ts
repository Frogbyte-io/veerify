/**
 * @openapi
 * /api/marketing/projects/{projectId}/terms:
 *   get:
 *     tags: [Marketing]
 *     summary: List brand, competitor and keyword terms of the product's site
 *     operationId: listMarketingTerms
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Terms and whether the caller can manage them }
 *       403: { description: Not a team member, or Marketing is off }
 *       404: { description: No site added yet }
 */
import { asc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { marketingTerm } from '~/server/database/schema/marketing'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { createSuccessResponse } from '~/server/utils/response'
import { isTeamAdminOf, requireRouteParam } from '~/server/utils/marketing-site'
import { MAX_TERMS_PER_SITE, requireMarketingSite, serializeTerm } from '~/server/utils/marketing-terms'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouteParam(event, 'projectId')
  const { teamId } = await requireMarketingAccess(projectId, session.user.id)
  const site = await requireMarketingSite(projectId)

  const rows = await db
    .select()
    .from(marketingTerm)
    .where(eq(marketingTerm.siteId, site.id))
    .orderBy(asc(marketingTerm.createdAt))

  return createSuccessResponse({
    terms: rows.map(serializeTerm),
    limit: MAX_TERMS_PER_SITE,
    canManage: await isTeamAdminOf(teamId, session.user.id),
  })
})
