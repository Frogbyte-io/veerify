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
 *       409: { description: Contact has conversations or merge tombstones }
 *       403: { description: Not a member of the contact's team }
 *       404: { description: Contact not found }
 */
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireContactAccess } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { contact, conversation } from '~/server/database/schema/support'
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

    // A merged contact is intentionally retained as a tombstone because old
    // conversations and provider references still point at its id. Deleting
    // it would either violate the conversation FK or destroy that history.
    const [lockedContact] = await tx
      .select({ mergedIntoContactId: contact.mergedIntoContactId })
      .from(contact)
      .where(eq(contact.id, contactId))
      .for('update')

    if (!lockedContact) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        data: createErrorResponse(ErrorCode.NOT_FOUND, 'Contact not found'),
      })
    }

    if (lockedContact.mergedIntoContactId) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'Merged contacts cannot be deleted'),
      })
    }

    const [tombstoneReference] = await tx
      .select({ id: contact.id })
      .from(contact)
      .where(eq(contact.mergedIntoContactId, contactId))
      .limit(1)

    if (tombstoneReference) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'Contacts with merge tombstones cannot be deleted'),
      })
    }

    const [conversationReference] = await tx
      .select({ id: conversation.id })
      .from(conversation)
      .where(eq(conversation.contactId, contactId))
      .limit(1)

    if (conversationReference) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'Contacts with conversations cannot be deleted'),
      })
    }

    await tx.delete(contact).where(eq(contact.id, contactId))
  })

  return createSuccessResponse({ deleted: true })
})
