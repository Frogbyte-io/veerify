/**
 * @openapi
 * /api/support/contacts/{id}/merge:
 *   post:
 *     tags: [Support]
 *     summary: Merge another contact into this one
 *     description: >
 *       The path contact survives. The source contact is retained as a tombstone
 *       with mergedIntoContactId set, so stale references still resolve.
 *     operationId: mergeSupportContact
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Merged }
 *       400: { description: Contacts cannot be merged }
 *       403: { description: Not a member of the contact's team }
 *       404: { description: Contact not found }
 */
import { z } from 'zod'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireContactAccess } from '~/server/utils/support-access'
import { backfillContactFields, canMerge, mergeAttributes } from '~/server/utils/contact-merge'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { contact, contactIdentity, contactLink } from '~/server/database/schema/support'

const bodySchema = z.object({
  sourceContactId: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const survivorId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)

  // Access is checked on BOTH contacts. Holding access to the survivor says
  // nothing about the source, and the source id comes straight from the request.
  const survivor = await requireContactAccess(survivorId, session.user.id)
  const loser = await requireContactAccess(body.sourceContactId, session.user.id)

  const check = canMerge(survivor, loser)
  if (!check.ok) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, check.reason),
    })
  }

  await db.transaction(async (tx) => {
    // Lock both rows in a deterministic order. This serializes inverse and
    // overlapping merges before any identities or links are moved.
    const lockedContacts = await tx
      .select()
      .from(contact)
      .where(inArray(contact.id, [survivorId, body.sourceContactId]))
      .orderBy(asc(contact.id))
      .for('update')

    const lockedSurvivor = lockedContacts.find((row) => row.id === survivorId)
    const lockedLoser = lockedContacts.find((row) => row.id === body.sourceContactId)
    if (!lockedSurvivor || !lockedLoser) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        data: createErrorResponse(ErrorCode.NOT_FOUND, 'Contact not found'),
      })
    }

    // Re-read the guards after acquiring both locks. A competing merge may
    // have tombstoned either row while the access checks above were running.
    const lockedCheck = canMerge(lockedSurvivor, lockedLoser)
    if (!lockedCheck.ok) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, lockedCheck.reason),
      })
    }

    // Links first. `contactLink` is unique on (contactId, entityType, entityId),
    // so if both contacts link to the same entity, repointing would violate it.
    // Drop the loser's duplicates before moving the rest.
    const survivorLinks = await tx
      .select({ entityType: contactLink.entityType, entityId: contactLink.entityId })
      .from(contactLink)
      .where(eq(contactLink.contactId, lockedSurvivor.id))

    const loserLinks = await tx
      .select({ id: contactLink.id, entityType: contactLink.entityType, entityId: contactLink.entityId })
      .from(contactLink)
      .where(eq(contactLink.contactId, lockedLoser.id))

    const survivorKeys = new Set(survivorLinks.map((l) => `${l.entityType}:${l.entityId}`))
    const duplicateIds = loserLinks.filter((l) => survivorKeys.has(`${l.entityType}:${l.entityId}`)).map((l) => l.id)

    if (duplicateIds.length > 0) {
      await tx.delete(contactLink).where(inArray(contactLink.id, duplicateIds))
    }

    await tx.update(contactLink).set({ contactId: lockedSurvivor.id }).where(eq(contactLink.contactId, lockedLoser.id))

    // Identities are unique on (teamId, kind, value) and both contacts are in
    // the same team, so the database already guarantees no collision here.
    await tx
      .update(contactIdentity)
      .set({ contactId: lockedSurvivor.id })
      .where(eq(contactIdentity.contactId, lockedLoser.id))

    await tx
      .update(contact)
      .set({
        ...backfillContactFields(lockedSurvivor, lockedLoser),
        attributes: mergeAttributes(lockedSurvivor.attributes, lockedLoser.attributes),
        updatedAt: new Date(),
      })
      .where(eq(contact.id, lockedSurvivor.id))

    // Tombstone rather than delete, so anything still holding the old id
    // resolves to the survivor instead of 404ing.
    await tx
      .update(contact)
      .set({ mergedIntoContactId: lockedSurvivor.id, updatedAt: new Date() })
      .where(and(eq(contact.id, lockedLoser.id), eq(contact.teamId, lockedSurvivor.teamId)))
  })

  const [merged] = await db.select().from(contact).where(eq(contact.id, survivorId)).limit(1)

  return createSuccessResponse({ contact: merged, mergedFrom: loser.id })
})
