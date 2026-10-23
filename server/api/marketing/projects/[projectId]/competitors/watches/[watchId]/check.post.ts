/**
 * @openapi
 * /api/marketing/projects/{projectId}/competitors/watches/{watchId}/check:
 *   post:
 *     tags: [Marketing]
 *     summary: Check a watched page now
 *     description: >
 *       Marketing admin only, and the site must be verified. Refused when the watch was checked
 *       in the last hour; also at most 3 manual checks per day per site and competitor host (so deleting
 *       and re-creating a watch does not reset the limit). Takes the same claim as the scheduled
 *       check and uses the same robots.txt, per-host spacing and SSRF-safe fetch path. The first
 *       check of a page records its baseline.
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
 *       403: { description: Not a marketing admin, Marketing is off, or the site is not verified }
 *       404: { description: Watch not found for this product }
 *       429: { description: Checked within the last hour, or the daily manual check limit is reached }
 */
import { checkWatchNow, MANUAL_CHECK_MIN_INTERVAL_MS } from '~/server/services/marketing/competitors/checker'
import { loadWatchContext } from '~/server/services/marketing/competitors/store'
import { canonicalHost } from '~/server/services/marketing/competitors/hosts'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import { MANUAL_CHECKS_PER_DAY } from '~/server/utils/marketing-competitors'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { requireMarketingSite } from '~/server/utils/marketing-terms'
import { requireRateLimit } from '~/server/utils/rate-limit'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
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

  // Same gate as the scheduler: only verified sites get competitor pages fetched.
  if (!site.verifiedAt) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'Verify your site before checking competitor pages'),
    })
  }

  const tooSoon = () =>
    createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      data: createErrorResponse(ErrorCode.RATE_LIMITED, 'This page was checked less than an hour ago. Try again later'),
    })
  // Decided on database state, so deleting and re-creating the watch cannot get around it.
  if (watch.lastCheckedAt && Date.now() - watch.lastCheckedAt.getTime() < MANUAL_CHECK_MIN_INTERVAL_MS) throw tooSoon()

  let host = watch.url
  try {
    host = canonicalHost(new URL(watch.url).hostname)
  } catch {
    // keep the raw url as the key
  }
  await requireRateLimit(event, {
    identifier: 'marketing-competitor-check',
    subject: `${site.id}:${host}`,
    maxRequests: MANUAL_CHECKS_PER_DAY,
    windowSeconds: 24 * 60 * 60,
  })

  const outcome = await checkWatchNow(watch)
  if (outcome === 'busy') throw tooSoon()
  if (outcome === 'skipped') {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      data: createErrorResponse(ErrorCode.RATE_LIMITED, 'That website was just checked. Try again in a moment'),
    })
  }
  return createSuccessResponse({ outcome })
})
