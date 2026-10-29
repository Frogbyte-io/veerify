/**
 * @openapi
 * /api/support/inboxes/{id}/addresses/{addressId}:
 *   delete:
 *     tags: [Support]
 *     summary: Remove a receiving address from an inbox
 *     description: >
 *       Platform forwarding addresses cannot be deleted (409); regenerate them
 *       through the platform address endpoint instead. Deleting a custom
 *       address also removes its provider inbound route, best-effort.
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
 *       403: { description: Not a member of this inbox or a project admin }
 *       404: { description: Inbox or address not found }
 *       409: { description: Platform addresses cannot be deleted - regenerate instead }
 */
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxRole } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { projectMailAddress } from '~/server/database/schema/support'
import { deleteDirectRouteForAddress } from '~/server/utils/inbound-routes'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string
  const addressId = getRouterParam(event, 'addressId') as string

  await requireInboxRole(inboxId, session.user.id, 'admin')

  const [existing] = await db
    .select({ kind: projectMailAddress.kind })
    .from(projectMailAddress)
    .where(and(eq(projectMailAddress.id, addressId), eq(projectMailAddress.inboxId, inboxId)))
    .limit(1)

  if (existing?.kind === 'platform') {
    // Deleting would leave the inbox with no forwarding target and invite a
    // manual re-add of the same guessable address. Regenerate replaces it.
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(
        ErrorCode.CONFLICT,
        'Platform addresses cannot be deleted. Regenerate the address instead.'
      ),
    })
  }

  const [deleted] = await db
    .delete(projectMailAddress)
    .where(and(eq(projectMailAddress.id, addressId), eq(projectMailAddress.inboxId, inboxId)))
    .returning({ id: projectMailAddress.id, providerRouteId: projectMailAddress.providerRouteId })

  if (deleted) await deleteDirectRouteForAddress({ id: deleted.id, providerRouteId: deleted.providerRouteId })

  if (!deleted) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Address not found on this inbox'),
    })
  }

  return createSuccessResponse({ deleted: true })
})
