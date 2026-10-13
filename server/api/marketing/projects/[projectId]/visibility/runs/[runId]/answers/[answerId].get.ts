/**
 * @openapi
 * /api/marketing/projects/{projectId}/visibility/runs/{runId}/answers/{answerId}:
 *   get:
 *     tags: [Marketing]
 *     summary: Get one sampled answer with its full text
 *     operationId: getVisibilityAnswer
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: runId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: answerId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: The answer including its text }
 *       403: { description: Marketing is not enabled or no team access }
 *       404: { description: Run or answer not found for this product }
 */
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { aiVisibilityAnswer } from '~/server/database/schema/marketing'
import { requireSiteRun, requireVisibilityRequest } from '~/server/services/marketing/visibility/access'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { site } = await requireVisibilityRequest(event)
  // The run must belong to this product's site, the answer to that run
  const run = await requireSiteRun(site.id, getRouterParam(event, 'runId') ?? '')

  const [answer] = await db
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
    .where(
      and(eq(aiVisibilityAnswer.id, getRouterParam(event, 'answerId') ?? ''), eq(aiVisibilityAnswer.runId, run.id))
    )
    .limit(1)
  if (!answer) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Answer not found'),
    })
  }

  return createSuccessResponse({ answer })
})
