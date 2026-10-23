/**
 * @openapi
 * /api/marketing/projects/{projectId}/terms/{termId}:
 *   delete:
 *     tags: [Marketing]
 *     summary: Delete a term
 *     operationId: deleteMarketingTerm
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: termId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Term deleted }
 *       403: { description: Not a team member, or Marketing is off }
 *       404: { description: Term or site not found }
 */
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { marketingTerm } from '~/server/database/schema/marketing'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { requireMarketingSite } from '~/server/utils/marketing-terms'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  const termId = requireRouteParam(event, 'termId')
  await requireMarketingAccess(projectId, session.user.id)
  const site = await requireMarketingSite(projectId)

  const deleted = await db
    .delete(marketingTerm)
    .where(and(eq(marketingTerm.id, termId), eq(marketingTerm.siteId, site.id)))
    .returning({ id: marketingTerm.id })
  if (deleted.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Term not found'),
    })
  }

  return createSuccessResponse({ id: termId })
})
