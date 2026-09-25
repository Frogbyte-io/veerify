import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import type { db } from '~/server/database/drizzle'
import { teamMember } from '~/server/database/schema/auth'
import { contact, contactLink } from '~/server/database/schema/support'
import { lockContactTeam } from '~/server/utils/contact-lock'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

function contactNotFound(): never {
  throw createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    data: createErrorResponse(ErrorCode.NOT_FOUND, 'Contact not found'),
  })
}

function linkNotFound(): never {
  throw createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    data: createErrorResponse(ErrorCode.NOT_FOUND, 'Contact link not found'),
  })
}

/**
 * Authorize and remove a contact link under the owning team's lifecycle lock.
 *
 * The first contact read only discovers the team row to lock. The contact is
 * then re-read after that lock, so a merge/delete that committed while this
 * request was starting cannot leave us acting on stale contact ownership.
 */
export async function deleteContactLinkInTransaction(
  tx: Transaction,
  contactId: string,
  linkId: string,
  userId: string
) {
  const [candidate] = await tx
    .select({ teamId: contact.teamId })
    .from(contact)
    .where(eq(contact.id, contactId))
    .limit(1)

  if (!candidate) contactNotFound()

  await lockContactTeam(tx, candidate.teamId)

  const [lockedContact] = await tx
    .select({ id: contact.id, teamId: contact.teamId })
    .from(contact)
    .where(eq(contact.id, contactId))
    .for('update')

  if (!lockedContact) contactNotFound()

  const [membership] = await tx
    .select({ id: teamMember.id })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, lockedContact.teamId), eq(teamMember.userId, userId)))
    .limit(1)

  if (!membership) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You do not have access to this team'),
    })
  }

  const [deleted] = await tx
    .delete(contactLink)
    .where(and(eq(contactLink.id, linkId), eq(contactLink.contactId, contactId)))
    .returning({ id: contactLink.id })

  if (!deleted) linkNotFound()

  return { deleted: true }
}
