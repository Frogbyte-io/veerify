/**
 * @openapi
 * /api/marketing/projects/{projectId}/competitors/watches/{watchId}/check:
 *   post:
 *     tags: [Marketing]
 *     summary: Check a watched page now
 *     description: >
 *       Marketing admin only, at most 3 manual checks per watch per day. Uses the same
 *       robots.txt and SSRF-safe fetch path as the scheduled check. The first check of a
 *       page records its baseline.
 *     operationId: checkMarketingCompetitorWatch
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: watchId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Check finished; `outcome` says what happened }
 *       403: { description: Not a marketing admin, or Marketing is off }
 *       404: { description: Watch not found for this product }
 *       429: { description: Daily manual check limit reached for this watch }
 */
import { checkWatchNow } from '~/server/services/marketing/competitors/checker'
import { loadWatchContext } from '~/server/services/marketing/competitors/store'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import { MANUAL_CHECKS_PER_DAY } from '~/server/utils/marketing-competitors'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { requireMarketingSite } from '~/server/utils/marketing-terms'
import { requireRateLimit } from '~/server/utils/rate-limit'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouteParam(event, 'projectId')
  const watchId = requireRouteParam(event, 'watchId')
  await requireMarketingAdmin(projectId, session.user.id)
  const site = await requireMarketingSite(projectId)

  const watch = await loadWatchContext(watchId, site.id)
  if (!watch) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Watch not found'),
    })
  }

  await requireRateLimit(event, {
    identifier: 'marketing-competitor-check',
    subject: watch.id,
    maxRequests: MANUAL_CHECKS_PER_DAY,
    windowSeconds: 24 * 60 * 60,
  })

  const outcome = await checkWatchNow(watch)
  return createSuccessResponse({ outcome })
})
