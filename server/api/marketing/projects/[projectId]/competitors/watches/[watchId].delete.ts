/**
 * @openapi
 * /api/marketing/projects/{projectId}/competitors/watches/{watchId}:
 *   delete:
 *     tags: [Marketing]
 *     summary: Stop watching a competitor page
 *     description: Marketing admin only. Its recorded changes are deleted with it.
 *     operationId: deleteMarketingCompetitorWatch
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
 *       200: { description: Watch deleted }
 *       403: { description: Not a marketing admin, or Marketing is off }
 *       404: { description: Watch not found for this product }
 */
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { competitorWatch } from '~/server/database/schema/marketing'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { requireMarketingSite } from '~/server/utils/marketing-terms'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  const watchId = requireRouteParam(event, 'watchId')
  await requireMarketingAdmin(projectId, session.user.id)
  const site = await requireMarketingSite(projectId)

  const deleted = await db
    .delete(competitorWatch)
    .where(and(eq(competitorWatch.id, watchId), eq(competitorWatch.siteId, site.id)))
    .returning({ id: competitorWatch.id })
  if (deleted.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Watch not found'),
    })
  }

  return createSuccessResponse({ id: watchId })
})
