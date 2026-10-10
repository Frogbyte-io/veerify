/**
 * @openapi
 * /api/marketing/projects/{projectId}/visibility/summary:
 *   get:
 *     tags: [Marketing]
 *     summary: AI visibility results for a run (latest finished run by default)
 *     description: >
 *       Mention rate overall, per provider and per prompt x provider, average rank,
 *       share of voice, top cited domains and the mention-rate trend over the last
 *       12 finished runs. Results come from provider APIs with web search and
 *       approximate, not replicate, the consumer apps.
 *     operationId: getVisibilitySummary
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: runId
 *         schema: { type: string }
 *     responses:
 *       200: { description: Summary; `run` is null when no run has finished yet }
 *       403: { description: Marketing is not enabled or no team access }
 *       404: { description: Run not found for this product }
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import {
  aiVisibilityAnswer,
  aiVisibilityPrompt,
  aiVisibilityRun,
  marketingTerm,
} from '~/server/database/schema/marketing'
import { requireSiteRun, requireVisibilityRequest } from '~/server/services/marketing/visibility/access'
import { buildVisibilitySummary } from '~/server/services/marketing/visibility/summary'
import { createSuccessResponse } from '~/server/utils/response'

const FINISHED = ['done', 'partial'] as const

export default defineEventHandler(async (event) => {
  const { site } = await requireVisibilityRequest(event)

  const query = getQuery(event)
  const requestedRunId = typeof query.runId === 'string' && query.runId ? query.runId : null

  let run
  if (requestedRunId) {
    run = await requireSiteRun(site.id, requestedRunId)
  } else {
    ;[run] = await db
      .select()
      .from(aiVisibilityRun)
      .where(and(eq(aiVisibilityRun.siteId, site.id), inArray(aiVisibilityRun.status, [...FINISHED])))
      .orderBy(desc(aiVisibilityRun.createdAt), desc(aiVisibilityRun.id))
      .limit(1)
  }

  if (!run) return createSuccessResponse({ run: null, summary: null, trend: [] })

  const [rows, prompts, brandTerms, trendRows] = await Promise.all([
    db
      .select({
        promptId: aiVisibilityAnswer.promptId,
        provider: aiVisibilityAnswer.provider,
        brandMentioned: aiVisibilityAnswer.brandMentioned,
        brandRank: aiVisibilityAnswer.brandRank,
        competitorsMentioned: aiVisibilityAnswer.competitorsMentioned,
        citationDomains: aiVisibilityAnswer.citationDomains,
      })
      .from(aiVisibilityAnswer)
      .where(and(eq(aiVisibilityAnswer.runId, run.id), eq(aiVisibilityAnswer.status, 'done'))),
    db
      .select({ id: aiVisibilityPrompt.id, text: aiVisibilityPrompt.text })
      .from(aiVisibilityPrompt)
      .where(eq(aiVisibilityPrompt.siteId, site.id))
      .orderBy(asc(aiVisibilityPrompt.createdAt), asc(aiVisibilityPrompt.id)),
    db
      .select({ label: marketingTerm.label })
      .from(marketingTerm)
      .where(and(eq(marketingTerm.siteId, site.id), eq(marketingTerm.kind, 'brand')))
      .orderBy(asc(marketingTerm.createdAt), asc(marketingTerm.id))
      .limit(1),
    db
      .select({
        runId: aiVisibilityRun.id,
        createdAt: aiVisibilityRun.createdAt,
        finishedAt: aiVisibilityRun.finishedAt,
        mentioned: sql<number>`count(*) filter (where ${aiVisibilityAnswer.brandMentioned} = true)`.mapWith(Number),
        total: sql<number>`count(*) filter (where ${aiVisibilityAnswer.brandMentioned} is not null)`.mapWith(Number),
      })
      .from(aiVisibilityRun)
      .innerJoin(aiVisibilityAnswer, eq(aiVisibilityAnswer.runId, aiVisibilityRun.id))
      .where(and(eq(aiVisibilityRun.siteId, site.id), inArray(aiVisibilityRun.status, [...FINISHED])))
      .groupBy(aiVisibilityRun.id)
      .orderBy(desc(aiVisibilityRun.createdAt))
      .limit(12),
  ])

  const answeredPromptIds = new Set(rows.map((r) => r.promptId))
  const summary = buildVisibilitySummary(rows, {
    brandLabel: brandTerms[0]?.label ?? '',
    prompts: prompts.filter((p) => answeredPromptIds.has(p.id)),
    providers: run.providers,
  })

  const trend = trendRows
    .map((row) => ({
      runId: row.runId,
      at: row.finishedAt ?? row.createdAt,
      mentioned: row.mentioned,
      total: row.total,
      rate: row.total === 0 ? 0 : row.mentioned / row.total,
    }))
    .reverse()

  return createSuccessResponse({ run, summary, trend })
})
