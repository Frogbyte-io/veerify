/**
 * @openapi
 * /api/support/inboxes/{id}:
 *   get:
 *     tags: [Support]
 *     summary: Get an inbox
 *     operationId: getSupportInbox
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Inbox detail }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Inbox not found }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxAccess } from '~/server/utils/support-access'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string

  const inbox = await requireInboxAccess(inboxId, session.user.id)

  return createSuccessResponse({ inbox })
})
