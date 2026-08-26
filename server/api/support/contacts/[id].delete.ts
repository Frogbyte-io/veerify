/**
 * @openapi
 * /api/support/contacts/{id}:
 *   delete:
 *     tags: [Support]
 *     summary: Delete a contact
 *     description: >
 *       Hard delete. Cascades the contact's identities and links. Feedback is
 *       never touched — contacts and feedback are deliberately not coupled.
 *     operationId: deleteSupportContact
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Contact deleted }
 *       403: { description: Not a member of the contact's team }
 *       404: { description: Contact not found }
 */
import { eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireContactAccess } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { contact } from '~/server/database/schema/support'
import { lockContactTeam } from '~/server/utils/contact-lock'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const contactId = getRouterParam(event, 'id') as string

  const accessibleContact = await requireContactAccess(contactId, session.user.id)

  // contactIdentity and contactLink cascade. Feedback rows are untouched by
  // construction: contactLink references them loosely by (entityType, entityId)
  // with no foreign key, so an erasure request against a contact removes the
  // contact and its links, and leaves public feedback exactly as submitted.
  await db.transaction(async (tx) => {
    await lockContactTeam(tx, accessibleContact.teamId)
    await tx.delete(contact).where(eq(contact.id, contactId))
  })

  return createSuccessResponse({ deleted: true })
})
