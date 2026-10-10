/**
 * @openapi
 * /api/marketing/projects/{projectId}/visibility/runs:
 *   post:
 *     tags: [Marketing]
 *     summary: Start an AI visibility run
 *     description: >
 *       Requires a verified site, a brand term, an active prompt and a usable LLM key.
 *       One queued or running run per site; at most 3 manual runs per site per day.
 *     operationId: createVisibilityRun
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Run created }
 *       403: { description: Marketing is not enabled or no team access }
 *       409: { description: Setup incomplete or a run is already in progress }
 *       429: { description: Daily manual run limit reached }
 */
import { and, eq, gte, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { aiVisibilityRun } from '~/server/database/schema/marketing'
import { requireVisibilityRequest } from '~/server/services/marketing/visibility/access'
import { createRun, VisibilityRunError } from '~/server/services/marketing/visibility/runner'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'

const MANUAL_RUNS_PER_DAY = 3

export default defineEventHandler(async (event) => {
  const { site } = await requireVisibilityRequest(event)

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [recent] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(aiVisibilityRun)
    .where(
      and(
        eq(aiVisibilityRun.siteId, site.id),
        eq(aiVisibilityRun.trigger, 'manual'),
        gte(aiVisibilityRun.createdAt, since)
      )
    )
  if ((recent?.n ?? 0) >= MANUAL_RUNS_PER_DAY) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      data: createErrorResponse(
        ErrorCode.RATE_LIMITED,
        `You can start at most ${MANUAL_RUNS_PER_DAY} manual runs per day. The weekly run still happens automatically`
      ),
    })
  }

  try {
    const { run, answerCount } = await createRun({ siteId: site.id, trigger: 'manual' })
    return createSuccessResponse({
      run: { ...run, progress: { total: answerCount, pending: answerCount, done: 0, failed: 0 } },
    })
  } catch (err) {
    if (err instanceof VisibilityRunError) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, err.message, { reason: err.code }),
      })
    }
    throw err
  }
})
