/**
 * @openapi
 * /api/marketing/projects/{projectId}/announcements/{entryId}/{channel}:
 *   delete:
 *     tags: [Marketing]
 *     summary: Delete an announcement draft
 *     operationId: deleteMarketingAnnouncement
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: channel
 *         required: true
 *         schema: { type: string, enum: [x, linkedin, bluesky, newsletter] }
 *     responses:
 *       200: { description: Draft deleted (also when none existed) }
 *       403: { description: Marketing is not enabled or no project access }
 *       404: { description: Entry or channel not found }
 */
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { deleteAnnouncementDraft, isAnnouncementChannel } from '~/server/services/marketing/announcements/service'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  const entryId = requireRouteParam(event, 'entryId')
  const channel = requireRouteParam(event, 'channel')
  await requireMarketingAccess(projectId, session.user.id)
  if (!isAnnouncementChannel(channel)) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Unknown channel'),
    })
  }

  await deleteAnnouncementDraft({ projectId, entryId, channel })
  return createSuccessResponse({ deleted: true })
})
