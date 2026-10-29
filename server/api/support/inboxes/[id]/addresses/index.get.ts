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
 *       403: { description: Not a member of this inbox or a project admin }
 *       404: { description: Inbox not found }
 */
import { asc, eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxAccess } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { projectMailAddress } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string

  await requireInboxAccess(inboxId, session.user.id)

  const addresses = await db
    .select()
    .from(projectMailAddress)
    .where(eq(projectMailAddress.inboxId, inboxId))
    .orderBy(asc(projectMailAddress.createdAt))

  return createSuccessResponse({ addresses })
})
