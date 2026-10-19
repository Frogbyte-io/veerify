/**
 * @openapi
 * /api/support/inboxes/{id}/addresses:
 *   get:
 *     tags: [Support]
 *     summary: List an inbox's receiving addresses
 *     operationId: listSupportInboxAddresses
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Address list }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Inbox not found }
 */
import { asc, eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxAccess } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { supportInboxAddress } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string

  await requireInboxAccess(inboxId, session.user.id)

  const addresses = await db
    .select()
    .from(supportInboxAddress)
    .where(eq(supportInboxAddress.inboxId, inboxId))
    .orderBy(asc(supportInboxAddress.createdAt))

  return createSuccessResponse({ addresses })
})
