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
 *       403: { description: Not a member of this inbox or a project admin }
 *       404: { description: Inbox not found }
 *       409: { description: Inbox still has conversations }
 */
import { and, eq, isNotNull } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxRole } from '~/server/utils/support-access'
import { isForeignKeyViolation } from '~/server/utils/support-errors'
import { db } from '~/server/database/drizzle'
import { projectMailAddress, supportInbox } from '~/server/database/schema/support'
import { deleteDirectRouteForAddress } from '~/server/utils/inbound-routes'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string

  await requireInboxRole(inboxId, session.user.id, 'admin')

  // Addresses cascade with the inbox, but their provider inbound routes do
  // not; read them first and remove the routes once the inbox is gone.
  const routed = await db
    .select({ id: projectMailAddress.id, providerRouteId: projectMailAddress.providerRouteId })
    .from(projectMailAddress)
    .where(and(eq(projectMailAddress.inboxId, inboxId), isNotNull(projectMailAddress.providerRouteId)))

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

  for (const address of routed) await deleteDirectRouteForAddress(address)

  return createSuccessResponse({ deleted: true })
})
