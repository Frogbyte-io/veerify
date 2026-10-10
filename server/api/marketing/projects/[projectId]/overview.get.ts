/**
 * @openapi
 * /api/marketing/projects/{projectId}/overview:
 *   get:
 *     tags: [Marketing]
 *     summary: Marketing overview for a product
 *     description: >
 *       Setup checklist state, integration status, this month's usage and the
 *       latest audit, AI visibility run and new mention count.
 *     operationId: getMarketingOverview
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Overview }
 *       403: { description: Not a team member, or Marketing is off for the team or product }
 *       404: { description: Product not found }
 */
import { and, count, desc, eq, isNotNull } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import {
  aiVisibilityAnswer,
  aiVisibilityRun,
  marketingTerm,
  mention,
  seoAudit,
} from '~/server/database/schema/marketing'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { createSuccessResponse } from '~/server/utils/response'
import { findMarketingSite, requireRouteParam, serializeSite } from '~/server/utils/marketing-site'
import { getIntegrationStatus } from '~/server/utils/marketing-integrations'
import { getUsage } from '~/server/utils/marketing-usage'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouteParam(event, 'projectId')
  const { teamId } = await requireMarketingAccess(projectId, session.user.id)

  const [site, integrations, usage] = await Promise.all([
    findMarketingSite(projectId),
    getIntegrationStatus(teamId),
    getUsage(teamId),
  ])

  let hasBrandTerm = false
  let latestAudit = null
  let latestVisibilityRun = null
  let newMentions = 0

  if (site) {
    const [brandRows, auditRows, runRows, mentionRows] = await Promise.all([
      db
        .select({ total: count() })
        .from(marketingTerm)
        .where(and(eq(marketingTerm.siteId, site.id), eq(marketingTerm.kind, 'brand'))),
      db
        .select({
          id: seoAudit.id,
          score: seoAudit.score,
          mode: seoAudit.mode,
          status: seoAudit.status,
          finishedAt: seoAudit.finishedAt,
        })
        .from(seoAudit)
        .where(eq(seoAudit.siteId, site.id))
        .orderBy(desc(seoAudit.createdAt))
        .limit(1),
      db
        .select({ id: aiVisibilityRun.id, status: aiVisibilityRun.status, finishedAt: aiVisibilityRun.finishedAt })
        .from(aiVisibilityRun)
        .where(eq(aiVisibilityRun.siteId, site.id))
        .orderBy(desc(aiVisibilityRun.createdAt))
        .limit(1),
      db
        .select({ total: count() })
        .from(mention)
        .where(and(eq(mention.siteId, site.id), eq(mention.status, 'new'))),
    ])

    hasBrandTerm = (brandRows[0]?.total ?? 0) > 0
    latestAudit = auditRows[0] ?? null
    newMentions = mentionRows[0]?.total ?? 0

    const run = runRows[0]
    if (run) {
      const answers = await db
        .select({ brandMentioned: aiVisibilityAnswer.brandMentioned })
        .from(aiVisibilityAnswer)
        .where(and(eq(aiVisibilityAnswer.runId, run.id), isNotNull(aiVisibilityAnswer.brandMentioned)))
      const mentioned = answers.filter((a) => a.brandMentioned === true).length
      latestVisibilityRun = { ...run, mentionRate: answers.length > 0 ? mentioned / answers.length : null }
    }
  }

  const state = (id: string) => integrations.find((i) => i.id === id)?.state
  const usable = (id: string) => state(id) === 'ready'

  return createSuccessResponse({
    site: site ? serializeSite(site) : null,
    setup: {
      siteAdded: site !== null,
      siteVerified: site?.verifiedAt != null,
      hasBrandTerm,
      hasLlmKey: usable('anthropic') || usable('openai') || usable('gemini') || usable('perplexity'),
      hasCrawlKey: usable('firecrawl'),
    },
    integrations,
    usage,
    latestAudit,
    latestVisibilityRun,
    newMentions,
  })
})
