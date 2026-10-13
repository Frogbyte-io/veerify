/**
 * @openapi
 * /api/support/contacts/{id}/links/{linkId}:
 *   delete:
 *     tags: [Support]
 *     summary: Remove a contact link
 *     operationId: deleteSupportContactLink
 *     responses:
 *       200: { description: Link removed }
 *       403: { description: Not a member of the contact's team }
 *       404: { description: Contact or link not found }
 */
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { db } from '~/server/database/drizzle'
import { deleteContactLinkInTransaction } from '~/server/utils/contact-link-transaction'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const contactId = getRouterParam(event, 'id') as string
  const linkId = getRouterParam(event, 'linkId') as string

  await db.transaction((tx) => deleteContactLinkInTransaction(tx, contactId, linkId, session.user.id))

  return createSuccessResponse({ deleted: true })
})
