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
import { and, eq, inArray } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireContactAccess } from '~/server/utils/support-access'
import { backfillContactFields, canMerge, mergeAttributes } from '~/server/utils/contact-merge'
import { db } from '~/server/database/drizzle'
import { contact, contactIdentity, contactLink } from '~/server/database/schema/support'

const bodySchema = z.object({
  sourceContactId: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const survivorId = getRouterParam(event, 'id') as string
  const body = bodySchema.parse(await readBody(event))

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
    // Links first. `contactLink` is unique on (contactId, entityType, entityId),
    // so if both contacts link to the same entity, repointing would violate it.
    // Drop the loser's duplicates before moving the rest.
    const survivorLinks = await tx
      .select({ entityType: contactLink.entityType, entityId: contactLink.entityId })
      .from(contactLink)
      .where(eq(contactLink.contactId, survivor.id))

    const loserLinks = await tx
      .select({ id: contactLink.id, entityType: contactLink.entityType, entityId: contactLink.entityId })
      .from(contactLink)
      .where(eq(contactLink.contactId, loser.id))

    const survivorKeys = new Set(survivorLinks.map((l) => `${l.entityType}:${l.entityId}`))
    const duplicateIds = loserLinks.filter((l) => survivorKeys.has(`${l.entityType}:${l.entityId}`)).map((l) => l.id)

    if (duplicateIds.length > 0) {
      await tx.delete(contactLink).where(inArray(contactLink.id, duplicateIds))
    }

    await tx.update(contactLink).set({ contactId: survivor.id }).where(eq(contactLink.contactId, loser.id))

    // Identities are unique on (teamId, kind, value) and both contacts are in
    // the same team, so the database already guarantees no collision here.
    await tx.update(contactIdentity).set({ contactId: survivor.id }).where(eq(contactIdentity.contactId, loser.id))

    await tx
      .update(contact)
      .set({
        ...backfillContactFields(survivor, loser),
        attributes: mergeAttributes(survivor.attributes, loser.attributes),
        updatedAt: new Date(),
      })
      .where(eq(contact.id, survivor.id))

    // Tombstone rather than delete, so anything still holding the old id
    // resolves to the survivor instead of 404ing.
    await tx
      .update(contact)
      .set({ mergedIntoContactId: survivor.id, updatedAt: new Date() })
      .where(and(eq(contact.id, loser.id), eq(contact.teamId, survivor.teamId)))
  })

  const [merged] = await db.select().from(contact).where(eq(contact.id, survivor.id)).limit(1)

  return createSuccessResponse({ contact: merged, mergedFrom: loser.id })
})
