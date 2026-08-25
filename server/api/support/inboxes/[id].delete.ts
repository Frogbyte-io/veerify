/**
 * @openapi
 * /api/support/inboxes/{id}:
 *   delete:
 *     tags: [Support]
 *     summary: Delete an inbox
 *     description: >
 *       conversation.inboxId is a restrict FK - an inbox with any
 *       conversations cannot be deleted. Delete or reassign them first.
 *     operationId: deleteSupportInbox
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Inbox deleted }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Inbox not found }
 *       409: { description: Inbox still has conversations }
 */
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxRole } from '~/server/utils/support-access'
import { isForeignKeyViolation } from '~/server/utils/support-errors'
import { db } from '~/server/database/drizzle'
import { supportInbox } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string

  await requireInboxRole(inboxId, session.user.id, 'admin')

  try {
    await db.delete(supportInbox).where(eq(supportInbox.id, inboxId))
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'This inbox still has conversations and cannot be deleted'),
      })
    }
    throw error
  }

  return createSuccessResponse({ deleted: true })
})
