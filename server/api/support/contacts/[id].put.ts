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
import { requireContactAccess } from '~/server/utils/support-access'
import { isUniqueViolation } from '~/server/utils/support-errors'
import { db } from '~/server/database/drizzle'
import { contact, contactIdentity } from '~/server/database/schema/support'

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
  const body = bodySchema.parse(await readBody(event))

  const existing = await requireContactAccess(contactId, session.user.id)

  try {
    return await db.transaction(async (tx) => {
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
      if (body.email !== undefined && body.email !== existing.email) {
        if (existing.email) {
          await tx
            .delete(contactIdentity)
            .where(
              and(
                eq(contactIdentity.contactId, contactId),
                eq(contactIdentity.kind, 'email'),
                eq(contactIdentity.value, existing.email)
              )
            )
        }

        if (body.email) {
          await tx.insert(contactIdentity).values({
            id: randomUUID(),
            contactId,
            teamId: existing.teamId,
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
