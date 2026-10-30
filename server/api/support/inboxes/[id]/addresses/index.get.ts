/**
 * @openapi
 * /api/support/inboxes/{id}/addresses:
 *   get:
 *     tags: [Support]
 *     summary: List an inbox's receiving addresses
 *     description: >
 *       Each address carries its behaviour (`mail` or `helpdesk`), product tag,
 *       the project email domain it sits on (`domainId`), its provider route
 *       state and `isCatchAll` (true for `*@domain`). `canSendFrom` says whether a
 *       reply can be sent from the address (`fromAddressId` on a reply): a custom,
 *       non-catch-all address on a verified project email domain.
 *       `inboxSendingAddress` is the inbox's own sending address, which replies
 *       use when no address is chosen.
 *     operationId: listSupportInboxAddresses
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Address list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     addresses:
 *                       type: array
 *                       items:
 *                         allOf:
 *                           - $ref: '#/components/schemas/SupportInboxAddress'
 *                           - type: object
 *                             properties:
 *                               canSendFrom: { type: boolean }
 *                     inboxSendingAddress: { type: string, nullable: true }
 *       403: { description: Not a member of this inbox or a project admin }
 *       404: { description: Inbox not found }
 */
import { asc, eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxAccess } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { projectMailAddress } from '~/server/database/schema/support'
import { toInboxAddressListItem } from '~/server/utils/inbox-address-rules'
import { loadVerifiedMailDomains } from '~/server/utils/conversation-sender'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string

  const inbox = await requireInboxAccess(inboxId, session.user.id)

  const addresses = await db
    .select()
    .from(projectMailAddress)
    .where(eq(projectMailAddress.inboxId, inboxId))
    .orderBy(asc(projectMailAddress.createdAt))

  const verifiedDomains = await loadVerifiedMailDomains(inbox.projectId)

  return createSuccessResponse({
    addresses: addresses.map((row) => toInboxAddressListItem(row, verifiedDomains)),
    inboxSendingAddress: inbox.emailAddress ?? null,
  })
})
