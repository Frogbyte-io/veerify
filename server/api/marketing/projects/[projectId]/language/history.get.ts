/**
 * @openapi
 * /api/marketing/projects/{projectId}/language/history:
 *   get:
 *     tags: [Marketing]
 *     summary: Recent customer language runs (metadata only)
 *     operationId: listCustomerLanguageHistory
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: The 10 most recent runs without phrases }
 *       403: { description: Marketing is not enabled or no project access }
 *       404: { description: No marketing site is set up }
 */
import { and, desc, eq, gt } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { customerLanguageInsight } from '~/server/database/schema/marketing'
import { requireVisibilityRequest } from '~/server/services/marketing/visibility/access'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { site } = await requireVisibilityRequest(event)

  const runs = await db
    .select({
      id: customerLanguageInsight.id,
      provider: customerLanguageInsight.provider,
      model: customerLanguageInsight.model,
      itemCount: customerLanguageInsight.itemCount,
      sources: customerLanguageInsight.sources,
      createdAt: customerLanguageInsight.createdAt,
    })
    .from(customerLanguageInsight)
    .where(and(eq(customerLanguageInsight.siteId, site.id), gt(customerLanguageInsight.itemCount, 0)))
    .orderBy(desc(customerLanguageInsight.createdAt))
    .limit(10)

  return createSuccessResponse({ runs })
})
