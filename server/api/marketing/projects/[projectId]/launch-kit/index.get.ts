/**
 * @openapi
 * /api/marketing/projects/{projectId}/launch-kit:
 *   get:
 *     tags: [Marketing]
 *     summary: Launch kit checklist for a product
 *     description: >
 *       The curated directory catalog merged with the product's status per
 *       directory, the product's custom directories, and progress counts by status.
 *     operationId: getMarketingLaunchKit
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Directories, custom directories and progress }
 *       403: { description: Not a team member, or Marketing is off }
 *       404: { description: Product not found }
 */
import { asc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { launchKitItem } from '~/server/database/schema/marketing'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { createSuccessResponse } from '~/server/utils/response'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { buildLaunchKit, listCatalog } from '~/server/utils/marketing-launch-kit'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  await requireMarketingAccess(projectId, session.user.id)

  const rows = await db
    .select()
    .from(launchKitItem)
    .where(eq(launchKitItem.projectId, projectId))
    .orderBy(asc(launchKitItem.createdAt))

  return createSuccessResponse(buildLaunchKit(rows, listCatalog()))
})
