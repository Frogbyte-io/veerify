/**
 * @openapi
 * /api/marketing/projects/{projectId}/visibility/runs/{runId}/answers:
 *   get:
 *     tags: [Marketing]
 *     summary: List sampled answers of a run (optionally for one prompt)
 *     operationId: listVisibilityAnswers
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: runId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: promptId
 *         schema: { type: string }
 *     responses:
 *       200: { description: Answers with citations and analysis }
 *       403: { description: Marketing is not enabled or no team access }
 *       404: { description: Run or prompt not found for this product }
 */
import { and, asc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { aiVisibilityAnswer } from '~/server/database/schema/marketing'
import {
  requireSitePrompt,
  requireSiteRun,
  requireVisibilityRequest,
} from '~/server/services/marketing/visibility/access'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { site } = await requireVisibilityRequest(event)
  // Both the run and the prompt must belong to this product's site
  const run = await requireSiteRun(site.id, getRouterParam(event, 'runId') ?? '')

  const query = getQuery(event)
  const promptId = typeof query.promptId === 'string' && query.promptId ? query.promptId : null
  if (promptId) await requireSitePrompt(site.id, promptId)

  const conditions = [eq(aiVisibilityAnswer.runId, run.id)]
  if (promptId) conditions.push(eq(aiVisibilityAnswer.promptId, promptId))

  const answers = await db
    .select({
      id: aiVisibilityAnswer.id,
      promptId: aiVisibilityAnswer.promptId,
      provider: aiVisibilityAnswer.provider,
      model: aiVisibilityAnswer.model,
      sample: aiVisibilityAnswer.sample,
      status: aiVisibilityAnswer.status,
      answer: aiVisibilityAnswer.answer,
      citations: aiVisibilityAnswer.citations,
      brandMentioned: aiVisibilityAnswer.brandMentioned,
      brandRank: aiVisibilityAnswer.brandRank,
      competitorsMentioned: aiVisibilityAnswer.competitorsMentioned,
      citationDomains: aiVisibilityAnswer.citationDomains,
      brandSentiment: aiVisibilityAnswer.brandSentiment,
      error: aiVisibilityAnswer.error,
    })
    .from(aiVisibilityAnswer)
    .where(and(...conditions))
    .orderBy(asc(aiVisibilityAnswer.provider), asc(aiVisibilityAnswer.sample))
    .limit(500)

  return createSuccessResponse({ answers })
})
