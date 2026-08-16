/**
 * @openapi
 * /api/support/contacts/{id}:
 *   put:
 *     tags: [Support]
 *     summary: Update a contact
 *     operationId: updateSupportContact
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Contact updated }
 *       403: { description: Not a member of the contact's team }
 *       404: { description: Contact not found }
 *       409: { description: Another contact in the team already uses this email }
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { canUpdateContact } from '~/server/utils/contact-merge'
import { requireContactAccess } from '~/server/utils/support-access'
import { isUniqueViolation } from '~/server/utils/support-errors'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { contact, contactIdentity, supportCompany } from '~/server/database/schema/support'

const bodySchema = z.object({
  name: z.string().trim().max(200).nullable().optional(),
  email: z.string().trim().toLowerCase().email().max(320).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  companyId: z.string().nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).nullable().optional(),
  blockedAt: z.coerce.date().nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const contactId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)

  await requireContactAccess(contactId, session.user.id)

  try {
    return await db.transaction(async (tx) => {
      // The access check above establishes the caller's team membership. The
      // row itself must be re-read and locked here: a merge may have turned
      // this contact into a tombstone while the request was entering its
      // transaction.
      const [lockedContact] = await tx.select().from(contact).where(eq(contact.id, contactId)).for('update')

      if (!lockedContact) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Not Found',
          data: createErrorResponse(ErrorCode.NOT_FOUND, 'Contact not found'),
        })
      }

      const updateCheck = canUpdateContact(lockedContact)
      if (!updateCheck.ok) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Bad Request',
          data: createErrorResponse(ErrorCode.VALIDATION_ERROR, updateCheck.reason),
        })
      }

      if (body.companyId) {
        const [company] = await tx
          .select({ id: supportCompany.id })
          .from(supportCompany)
          .where(and(eq(supportCompany.id, body.companyId), eq(supportCompany.teamId, lockedContact.teamId)))
          .limit(1)

        if (!company) {
          throw createError({
            statusCode: 400,
            statusMessage: 'Bad Request',
            data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Company is not part of this team'),
          })
        }
      }

      const [updated] = await tx
        .update(contact)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.email !== undefined ? { email: body.email } : {}),
          ...(body.phone !== undefined ? { phone: body.phone } : {}),
          ...(body.companyId !== undefined ? { companyId: body.companyId } : {}),
          ...(body.attributes !== undefined ? { attributes: body.attributes } : {}),
          ...(body.blockedAt !== undefined ? { blockedAt: body.blockedAt } : {}),
          updatedAt: new Date(),
        })
        .where(eq(contact.id, contactId))
        .returning()

      // Keep the email identity in step with the column. If they drift, inbound
      // mail resolves to a contact whose displayed address is something else.
      if (body.email !== undefined && body.email !== lockedContact.email) {
        if (lockedContact.email) {
          await tx
            .delete(contactIdentity)
            .where(
              and(
                eq(contactIdentity.contactId, contactId),
                eq(contactIdentity.kind, 'email'),
                eq(contactIdentity.value, lockedContact.email)
              )
            )
        }

        if (body.email) {
          await tx.insert(contactIdentity).values({
            id: randomUUID(),
            contactId,
            teamId: lockedContact.teamId,
            kind: 'email',
            value: body.email,
            createdAt: new Date(),
          })
        }
      }

      return createSuccessResponse({ contact: updated })
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'Another contact in this team already uses this email'),
      })
    }
    throw error
  }
})
