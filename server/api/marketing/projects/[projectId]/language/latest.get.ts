/**
 * @openapi
 * /api/marketing/projects/{projectId}/language/latest:
 *   get:
 *     tags: [Marketing]
 *     summary: Latest customer language insight, consent and run availability
 *     operationId: getLatestCustomerLanguage
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: insight (or null), consent summary, canRun and a reason when not }
 *       403: { description: Marketing is not enabled or no team access }
 *       404: { description: No marketing site is set up }
 */
import { and, desc, eq, gt } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { customerLanguageInsight } from '~/server/database/schema/marketing'
import { requireVisibilityRequest } from '~/server/services/marketing/visibility/access'
import { getConsentSummary, requireConsentMember } from '~/server/services/marketing/customer-language/consent'
import { languageBlockReason } from '~/server/services/marketing/customer-language/service'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { site, teamId, userId } = await requireVisibilityRequest(event)
  const membership = await requireConsentMember(teamId, userId)

  const [insight] = await db
    .select()
    .from(customerLanguageInsight)
    .where(and(eq(customerLanguageInsight.siteId, site.id), gt(customerLanguageInsight.itemCount, 0)))
    .orderBy(desc(customerLanguageInsight.createdAt))
    .limit(1)

  const [consent, blocked] = await Promise.all([
    getConsentSummary(teamId),
    languageBlockReason({ teamId, siteId: site.id }),
  ])

  return createSuccessResponse({
    teamId,
    insight: insight ?? null,
    consent: { ...consent, canManage: membership.role === 'admin' },
    canRun: blocked === null,
    reason: blocked?.reason ?? null,
    message: blocked?.message ?? null,
  })
})
