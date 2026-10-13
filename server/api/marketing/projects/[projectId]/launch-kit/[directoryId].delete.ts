/**
 * @openapi
 * /api/marketing/projects/{projectId}/launch-kit/{directoryId}:
 *   delete:
 *     tags: [Marketing]
 *     summary: Remove a custom directory or reset a catalog directory to todo
 *     operationId: deleteMarketingLaunchKitItem
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: directoryId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Custom directory deleted, or catalog directory reset }
 *       403: { description: Not a team member, or Marketing is off }
 *       404: { description: Unknown directory }
 */
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { launchKitItem } from '~/server/database/schema/marketing'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { createSuccessResponse } from '~/server/utils/response'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { getLaunchDirectory, isCustomId, launchKitNotFound } from '~/server/utils/marketing-launch-kit'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouteParam(event, 'projectId')
  const directoryId = requireRouteParam(event, 'directoryId')
  await requireMarketingAccess(projectId, session.user.id)

  const custom = isCustomId(directoryId)
  if (!custom && !getLaunchDirectory(directoryId)) launchKitNotFound()

  // Removing the row is the reset: no row reads as todo with no URL, notes or dates
  const deleted = await db
    .delete(launchKitItem)
    .where(and(eq(launchKitItem.projectId, projectId), eq(launchKitItem.directoryId, directoryId)))
    .returning({ id: launchKitItem.id })

  if (custom && deleted.length === 0) launchKitNotFound()

  return createSuccessResponse({ deleted: custom, reset: !custom })
})
