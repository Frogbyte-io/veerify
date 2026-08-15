/**
 * @openapi
 * /api/support/inboxes/{id}/members:
 *   post:
 *     tags: [Support]
 *     summary: Add an agent to an inbox
 *     description: >
 *       The target user must already be a member of the inbox's team - an
 *       inbox agent is a team member granted support access, not an
 *       independent identity.
 *     operationId: addSupportInboxMember
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Member added }
 *       400: { description: userId is not a member of this team }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Inbox not found }
 *       409: { description: User is already a member of this inbox }
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxAccess } from '~/server/utils/support-access'
import { isUniqueViolation } from '~/server/utils/support-errors'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { supportInboxMember } from '~/server/database/schema/support'
import { teamMember } from '~/server/database/schema/auth'

const bodySchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['agent', 'supervisor', 'admin']),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)

  const inbox = await requireInboxAccess(inboxId, session.user.id)

  const [matchedMember] = await db
    .select({ id: teamMember.id })
    .from(teamMember)
    .where(and(eq(teamMember.teamId, inbox.teamId), eq(teamMember.userId, body.userId)))
    .limit(1)

  if (!matchedMember) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'userId is not a member of this team'),
    })
  }

  try {
    const [created] = await db
      .insert(supportInboxMember)
      .values({
        id: randomUUID(),
        inboxId,
        userId: body.userId,
        role: body.role,
        createdAt: new Date(),
      })
      .returning()

    return createSuccessResponse({ member: created })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'This user is already a member of this inbox'),
      })
    }
    throw error
  }
})
