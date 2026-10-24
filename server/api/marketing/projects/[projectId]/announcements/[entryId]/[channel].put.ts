/**
 * @openapi
 * /api/marketing/projects/{projectId}/announcements/{entryId}/{channel}:
 *   put:
 *     tags: [Marketing]
 *     summary: Save an edited announcement draft
 *     description: Content is trimmed and limited to 1.5 times the channel limit (x 280, bluesky 300, linkedin 1300, newsletter 2000). Marks the draft as edited.
 *     operationId: updateMarketingAnnouncement
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string }
 *     responses:
 *       200: { description: The saved draft }
 *       400: { description: Validation failed }
 *       403: { description: Marketing is not enabled or no project access }
 *       404: { description: Entry or channel not found }
 */
import { z } from 'zod'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import {
  isAnnouncementChannel,
  maxEditLength,
  saveAnnouncementEdit,
} from '~/server/services/marketing/announcements/service'

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

  const body = await validateBody(event, z.object({ content: z.string().trim().min(1).max(maxEditLength(channel)) }))
  const draft = await saveAnnouncementEdit({
    projectId,
    entryId,
    channel,
    content: body.content,
    userId: session.user.id,
  })
  return createSuccessResponse({ draft })
})
