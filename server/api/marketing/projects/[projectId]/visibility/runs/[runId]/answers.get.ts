/**
 * @openapi
 * /api/marketing/projects/{projectId}/visibility/runs/{runId}/answers:
 *   get:
 *     tags: [Marketing]
 *     summary: List sampled answers of a run (optionally for one prompt)
 *     description: >
 *       With `promptId` the answers of that prompt are returned including the
 *       full `answer` text (bounded: providers x samples). Without it only
 *       metadata is returned (no `answer` text), 100 per request; pass
 *       `nextCursor` as `cursor` for the next page and fetch single answers with
 *       `/answers/{answerId}`.
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
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200: { description: Answers with citations and analysis }
 *       403: { description: Marketing is not enabled or no project access }
 *       404: { description: Run or prompt not found for this product }
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { aiVisibilityAnswer } from '~/server/database/schema/marketing'
import {
  requireSitePrompt,
  requireSiteRun,
  requireVisibilityRequest,
} from '~/server/services/marketing/visibility/access'
import { createSuccessResponse } from '~/server/utils/response'

const METADATA_PAGE_SIZE = 100
const PROMPT_ANSWERS_LIMIT = 100

interface AnswerCursor {
  p: string
  v: string
  s: number
}

function decodeCursor(raw: unknown): AnswerCursor | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as AnswerCursor
    if (typeof parsed.p === 'string' && typeof parsed.v === 'string' && Number.isInteger(parsed.s)) return parsed
  } catch {
    // fall through
  }
  throw createError({ statusCode: 400, statusMessage: 'Invalid cursor' })
}

export default defineEventHandler(async (event) => {
  const { site } = await requireVisibilityRequest(event)
  // Both the run and the prompt must belong to this product's site
  const run = await requireSiteRun(site.id, getRouterParam(event, 'runId') ?? '')

  const query = getQuery(event)
  const promptId = typeof query.promptId === 'string' && query.promptId ? query.promptId : null
  if (promptId) await requireSitePrompt(site.id, promptId)

  const conditions = [eq(aiVisibilityAnswer.runId, run.id)]
  if (promptId) conditions.push(eq(aiVisibilityAnswer.promptId, promptId))

  const columns = {
    id: aiVisibilityAnswer.id,
    promptId: aiVisibilityAnswer.promptId,
    provider: aiVisibilityAnswer.provider,
    model: aiVisibilityAnswer.model,
    sample: aiVisibilityAnswer.sample,
    status: aiVisibilityAnswer.status,
    citations: aiVisibilityAnswer.citations,
    brandMentioned: aiVisibilityAnswer.brandMentioned,
    brandRank: aiVisibilityAnswer.brandRank,
    competitorsMentioned: aiVisibilityAnswer.competitorsMentioned,
    citationDomains: aiVisibilityAnswer.citationDomains,
    brandSentiment: aiVisibilityAnswer.brandSentiment,
    error: aiVisibilityAnswer.error,
  }

  // Per-prompt path: bounded by providers x samples (<= 4 x 10), keeps the full text
  if (promptId) {
    const answers = await db
      .select({ ...columns, answer: aiVisibilityAnswer.answer })
      .from(aiVisibilityAnswer)
      .where(and(...conditions))
      .orderBy(asc(aiVisibilityAnswer.provider), asc(aiVisibilityAnswer.sample))
      .limit(PROMPT_ANSWERS_LIMIT)
    return createSuccessResponse({ answers, nextCursor: null })
  }

  // Whole-run path: metadata only, keyset-paginated on the unique (run, prompt, provider, sample) index
  const cursor = decodeCursor(query.cursor)
  if (cursor) {
    conditions.push(
      sql`(${aiVisibilityAnswer.promptId}, ${aiVisibilityAnswer.provider}, ${aiVisibilityAnswer.sample}) > (${cursor.p}, ${cursor.v}, ${cursor.s})`
    )
  }
  const rows = await db
    .select(columns)
    .from(aiVisibilityAnswer)
    .where(and(...conditions))
    .orderBy(asc(aiVisibilityAnswer.promptId), asc(aiVisibilityAnswer.provider), asc(aiVisibilityAnswer.sample))
    .limit(METADATA_PAGE_SIZE + 1)
  const answers = rows.slice(0, METADATA_PAGE_SIZE)
  const last = answers[answers.length - 1]
  const nextCursor =
    rows.length > METADATA_PAGE_SIZE && last
      ? Buffer.from(JSON.stringify({ p: last.promptId, v: last.provider, s: last.sample })).toString('base64url')
      : null

  return createSuccessResponse({ answers, nextCursor })
})
