/**
 * @openapi
 * /api/marketing/projects/{projectId}/competitors/watches/{watchId}:
 *   patch:
 *     tags: [Marketing]
 *     summary: Pause, resume or re-label a watched page
 *     description: >
 *       Marketing admin only. Resuming also clears an error or robots.txt block, so the next
 *       scheduled check tries the page again.
 *     operationId: updateMarketingCompetitorWatch
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: watchId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [active, paused] }
 *               kind: { type: string, enum: [pricing, changelog, homepage, other] }
 *     responses:
 *       200: { description: Watch updated }
 *       400: { description: Validation failed }
 *       403: { description: Not a marketing admin, or Marketing is off }
 *       404: { description: Watch not found for this product }
 */
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { competitorWatch } from '~/server/database/schema/marketing'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import { serializeWatch, updateWatchSchema } from '~/server/utils/marketing-competitors'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { requireMarketingSite } from '~/server/utils/marketing-terms'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { validateBody } from '~/server/utils/validation'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  const watchId = requireRouteParam(event, 'watchId')
  await requireMarketingAdmin(projectId, session.user.id)
  const body = await validateBody(event, updateWatchSchema)
  const site = await requireMarketingSite(projectId)

  const patch: Partial<typeof competitorWatch.$inferInsert> = { updatedAt: new Date() }
  if (body.kind) patch.kind = body.kind
  if (body.status) {
    patch.status = body.status
    if (body.status === 'active') {
      patch.lastError = null
      patch.consecutiveFailures = 0
    }
  }

  // Scoped by siteId so another product's watch id reads as 404.
  const [updated] = await db
    .update(competitorWatch)
    .set(patch)
    .where(and(eq(competitorWatch.id, watchId), eq(competitorWatch.siteId, site.id)))
    .returning()
  if (!updated) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Watch not found'),
    })
  }

  return createSuccessResponse({ watch: serializeWatch(updated) })
})
