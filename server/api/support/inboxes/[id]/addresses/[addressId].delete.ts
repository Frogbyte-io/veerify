/**
 * @openapi
 * /api/support/inboxes/{id}/addresses/{addressId}:
 *   delete:
 *     tags: [Support]
 *     summary: Remove a receiving address from an inbox
 *     operationId: deleteSupportInboxAddress
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: addressId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Address deleted }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Inbox or address not found }
 */
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxRole } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { supportInboxAddress } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string
  const addressId = getRouterParam(event, 'addressId') as string

  await requireInboxRole(inboxId, session.user.id, 'admin')

  const [deleted] = await db
    .delete(supportInboxAddress)
    .where(and(eq(supportInboxAddress.id, addressId), eq(supportInboxAddress.inboxId, inboxId)))
    .returning({ id: supportInboxAddress.id })

  if (!deleted) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Address not found on this inbox'),
    })
  }

  return createSuccessResponse({ deleted: true })
})
