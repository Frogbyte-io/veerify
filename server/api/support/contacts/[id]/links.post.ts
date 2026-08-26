/**
 * @openapi
 * /api/support/contacts/{id}/links:
 *   post:
 *     tags: [Support]
 *     summary: Explicitly link a feedback item to a contact
 *     operationId: createSupportContactLink
 *     responses:
 *       200: { description: Link created }
 *       400: { description: Target is not in the contact's team }
 *       403: { description: Not a member of the contact's team }
 *       404: { description: Contact not found }
 *       409: { description: Link already exists }
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireContactAccess } from '~/server/utils/support-access'
import { isUniqueViolation } from '~/server/utils/support-errors'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { contact, contactLink } from '~/server/database/schema/support'
import { feedback, project } from '~/server/database/schema/feedback'
import { lockContactTeam } from '~/server/utils/contact-lock'

const bodySchema = z.object({
  entityType: z.literal('feedback'),
  entityId: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const contactId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)
  const accessibleContact = await requireContactAccess(contactId, session.user.id)

  try {
    return await db.transaction(async (tx) => {
      await lockContactTeam(tx, accessibleContact.teamId)

      const [lockedContact] = await tx
        .select({ id: contact.id, teamId: contact.teamId })
        .from(contact)
        .where(eq(contact.id, contactId))
        .for('update')

      if (!lockedContact || lockedContact.teamId !== accessibleContact.teamId) {
        throw createError({
          statusCode: 404,
          statusMessage: 'Not Found',
          data: createErrorResponse(ErrorCode.NOT_FOUND, 'Contact not found'),
        })
      }

      const [target] = await tx
        .select({ id: feedback.id })
        .from(feedback)
        .innerJoin(project, eq(project.id, feedback.projectId))
        .where(and(eq(feedback.id, body.entityId), eq(project.teamId, lockedContact.teamId)))
        .limit(1)

      if (!target) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Bad Request',
          data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Feedback is not part of this team'),
        })
      }

      const [link] = await tx
        .insert(contactLink)
        .values({
          id: randomUUID(),
          contactId,
          entityType: 'feedback',
          entityId: body.entityId,
          source: 'agent',
          createdByUserId: session.user.id,
          createdAt: new Date(),
        })
        .returning()

      return createSuccessResponse({ link })
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'This feedback item is already linked to the contact'),
      })
    }
    throw error
  }
})
