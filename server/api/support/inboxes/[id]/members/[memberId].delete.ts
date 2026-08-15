/**
 * @openapi
 * /api/support/inboxes/{id}/members/{memberId}:
 *   delete:
 *     tags: [Support]
 *     summary: Remove an agent from an inbox
 *     operationId: removeSupportInboxMember
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: memberId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Member removed }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Inbox or member not found }
 */
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxAccess } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { supportInboxMember } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string
  const memberId = getRouterParam(event, 'memberId') as string

  await requireInboxAccess(inboxId, session.user.id)

  const [deleted] = await db
    .delete(supportInboxMember)
    .where(and(eq(supportInboxMember.id, memberId), eq(supportInboxMember.inboxId, inboxId)))
    .returning({ id: supportInboxMember.id })

  if (!deleted) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Member not found on this inbox'),
    })
  }

  return createSuccessResponse({ deleted: true })
})
