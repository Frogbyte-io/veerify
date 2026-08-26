/**
 * @openapi
 * /api/support/contacts:
 *   post:
 *     tags: [Support]
 *     summary: Create a contact
 *     operationId: createSupportContact
 *     responses:
 *       200: { description: Contact created }
 *       403: { description: Not a member of the team }
 *       409: { description: A contact with this email already exists in the team }
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createError } from 'h3'
import { and, eq } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireTeamMembership } from '~/server/utils/support-access'
import { isUniqueViolation } from '~/server/utils/support-errors'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { contact, contactIdentity, supportCompany } from '~/server/database/schema/support'
import { lockContactTeam } from '~/server/utils/contact-lock'

const bodySchema = z.object({
  teamId: z.string().min(1),
  name: z.string().trim().max(200).optional(),
  email: z.string().trim().toLowerCase().email().max(320).optional(),
  phone: z.string().trim().max(50).optional(),
  companyId: z.string().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await validateBody(event, bodySchema)

  await requireTeamMembership(body.teamId, session.user.id)

  const now = new Date()
  const contactId = randomUUID()

  try {
    // The contact and its primary identity are created together: an identity-less
    // contact cannot be resolved from an inbound message, which is the only way
    // contacts get matched. Doing it in one transaction avoids that orphan state.
    return await db.transaction(async (tx) => {
      await lockContactTeam(tx, body.teamId)

      if (body.companyId) {
        const [company] = await tx
          .select({ id: supportCompany.id })
          .from(supportCompany)
          .where(and(eq(supportCompany.id, body.companyId), eq(supportCompany.teamId, body.teamId)))
          .limit(1)

        if (!company) {
          throw createError({
            statusCode: 400,
            statusMessage: 'Bad Request',
            data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Company is not part of this team'),
          })
        }
      }

      const [created] = await tx
        .insert(contact)
        .values({
          id: contactId,
          teamId: body.teamId,
          name: body.name ?? null,
          email: body.email ?? null,
          phone: body.phone ?? null,
          companyId: body.companyId ?? null,
          attributes: body.attributes ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      if (body.email) {
        await tx.insert(contactIdentity).values({
          id: randomUUID(),
          contactId,
          teamId: body.teamId,
          kind: 'email',
          value: body.email,
          createdAt: now,
        })
      }

      return createSuccessResponse({ contact: created })
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'A contact with this email already exists in this team'),
      })
    }
    throw error
  }
})
