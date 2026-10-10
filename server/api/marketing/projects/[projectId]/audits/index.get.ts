/**
 * @openapi
 * /api/marketing/projects/{projectId}/audits:
 *   get:
 *     tags: [Marketing]
 *     summary: List recent site audits for a product
 *     description: >
 *       Returns the 20 most recent audits plus whether a new audit can be
 *       started now (`canStart`, with the `reason` when not: `not_verified`,
 *       `active_audit` or `daily_limit`). Requires Marketing enabled for the
 *       team and the product.
 *     operationId: listMarketingAudits
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Recent audits and start availability }
 *       403: { description: Marketing not enabled or no access }
 *       404: { description: Project not found }
 */
import { desc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { seoAudit } from '~/server/database/schema/marketing'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { findSiteForProject } from '~/server/utils/marketing-audit-access'
import { createSuccessResponse } from '~/server/utils/response'
import { getAuditStartStatus } from '~/server/services/marketing/audit/runner'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  await requireMarketingAccess(projectId, session.user.id)

  const site = await findSiteForProject(projectId)
  if (!site) {
    return createSuccessResponse({
      site: null,
      audits: [],
      canStart: false,
      reason: 'not_verified',
      message: 'Add and verify your site in Marketing settings before running an audit',
      resetsAt: null,
    })
  }

  const audits = await db
    .select({
      id: seoAudit.id,
      status: seoAudit.status,
      mode: seoAudit.mode,
      score: seoAudit.score,
      pagesFetched: seoAudit.pagesFetched,
      pageLimit: seoAudit.pageLimit,
      trigger: seoAudit.trigger,
      startedAt: seoAudit.startedAt,
      finishedAt: seoAudit.finishedAt,
    })
    .from(seoAudit)
    .where(eq(seoAudit.siteId, site.id))
    .orderBy(desc(seoAudit.createdAt))
    .limit(20)

  const start = await getAuditStartStatus(site.id, 'manual')

  return createSuccessResponse({
    site: { id: site.id, origin: site.origin, verified: site.verifiedAt !== null },
    audits,
    canStart: start.canStart,
    reason: start.reason,
    message: start.message,
    resetsAt: start.resetsAt?.toISOString() ?? null,
  })
})
