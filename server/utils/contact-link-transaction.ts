import { and, eq } from 'drizzle-orm'
import { hasProjectAccess } from '~/server/utils/project-access'
import { createError } from 'h3'
import type { db } from '~/server/database/drizzle'
import { contact, contactLink } from '~/server/database/schema/support'
import { lockContactProject } from '~/server/utils/contact-lock'
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
 * Authorize and remove a contact link under the owning project's lifecycle lock.
 *
 * The first contact read only discovers the project row to lock. The contact is
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
    .select({ projectId: contact.projectId })
    .from(contact)
    .where(eq(contact.id, contactId))
    .limit(1)

  if (!candidate) contactNotFound()

  await lockContactProject(tx, candidate.projectId)

  const [lockedContact] = await tx
    .select({ id: contact.id, projectId: contact.projectId })
    .from(contact)
    .where(eq(contact.id, contactId))
    .for('update')

  if (!lockedContact) contactNotFound()

  if (!(await hasProjectAccess(lockedContact.projectId, userId))) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'You do not have access to this project'),
    })
  }

  const [deleted] = await tx
    .delete(contactLink)
    .where(and(eq(contactLink.id, linkId), eq(contactLink.contactId, contactId)))
    .returning({ id: contactLink.id })

  if (!deleted) linkNotFound()

  return { deleted: true }
}
