import { and, asc, eq, inArray } from 'drizzle-orm'
import { createError } from 'h3'
import type { db } from '~/server/database/drizzle'
import { contact, contactIdentity, contactLink } from '~/server/database/schema/support'
import { backfillContactFields, canMerge, mergeAttributes } from '~/server/utils/contact-merge'
import { lockContactTeams } from '~/server/utils/contact-lock'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function mergeContactsInTransaction(
  tx: Transaction,
  survivorId: string,
  sourceContactId: string
) {
  // These are deliberately non-locking reads. They provide the owning team
  // ids used to establish the stable lock order before either contact row is
  // locked. The contacts are re-read and validated below after the team lock.
  const candidates = await tx
    .select({ id: contact.id, teamId: contact.teamId })
    .from(contact)
    .where(inArray(contact.id, [survivorId, sourceContactId]))
    .orderBy(asc(contact.id))

  await lockContactTeams(tx, candidates.map((candidate) => candidate.teamId))

  const lockedContacts = await tx
    .select()
    .from(contact)
    .where(inArray(contact.id, [survivorId, sourceContactId]))
    .orderBy(asc(contact.id))
    .for('update')

  const lockedSurvivor = lockedContacts.find((row) => row.id === survivorId)
  const lockedLoser = lockedContacts.find((row) => row.id === sourceContactId)
  if (!lockedSurvivor || !lockedLoser) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Contact not found'),
    })
  }

  const lockedCheck = canMerge(lockedSurvivor, lockedLoser)
  if (!lockedCheck.ok) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, lockedCheck.reason),
    })
  }

  const survivorLinks = await tx
    .select({ entityType: contactLink.entityType, entityId: contactLink.entityId })
    .from(contactLink)
    .where(eq(contactLink.contactId, lockedSurvivor.id))

  const loserLinks = await tx
    .select({ id: contactLink.id, entityType: contactLink.entityType, entityId: contactLink.entityId })
    .from(contactLink)
    .where(eq(contactLink.contactId, lockedLoser.id))

  const survivorKeys = new Set(survivorLinks.map((link) => `${link.entityType}:${link.entityId}`))
  const duplicateIds = loserLinks
    .filter((link) => survivorKeys.has(`${link.entityType}:${link.entityId}`))
    .map((link) => link.id)

  if (duplicateIds.length > 0) {
    await tx.delete(contactLink).where(inArray(contactLink.id, duplicateIds))
  }

  await tx.update(contactLink).set({ contactId: lockedSurvivor.id }).where(eq(contactLink.contactId, lockedLoser.id))
  await tx.update(contactIdentity).set({ contactId: lockedSurvivor.id }).where(eq(contactIdentity.contactId, lockedLoser.id))

  await tx
    .update(contact)
    .set({
      ...backfillContactFields(lockedSurvivor, lockedLoser),
      attributes: mergeAttributes(lockedSurvivor.attributes, lockedLoser.attributes),
      updatedAt: new Date(),
    })
    .where(eq(contact.id, lockedSurvivor.id))

  await tx
    .update(contact)
    .set({ mergedIntoContactId: lockedSurvivor.id, updatedAt: new Date() })
    .where(and(eq(contact.id, lockedLoser.id), eq(contact.teamId, lockedSurvivor.teamId)))

  const [merged] = await tx.select().from(contact).where(eq(contact.id, survivorId)).limit(1)
  return { contact: merged, loser: lockedLoser }
}
