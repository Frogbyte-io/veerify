/**
 * @openapi
 * /api/support/tags:
 *   post:
 *     tags: [Support]
 *     summary: Create a tag
 *     operationId: createSupportTag
 *     responses:
 *       200: { description: Tag created }
 *       403: { description: Not a member of the team }
 *       409: { description: A tag with this name already exists in this team }
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireSupportTeamRole } from '~/server/utils/support-access'
import { isUniqueViolation } from '~/server/utils/support-errors'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { supportTag } from '~/server/database/schema/support'

const bodySchema = z.object({
  teamId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  color: z.string().trim().max(32).optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await validateBody(event, bodySchema)

  await requireSupportTeamRole(body.teamId, session.user.id, 'supervisor')

  try {
    const [created] = await db
      .insert(supportTag)
      .values({
        id: randomUUID(),
        teamId: body.teamId,
        name: body.name,
        color: body.color ?? null,
        createdAt: new Date(),
      })
      .returning()

    return createSuccessResponse({ tag: created })
  } catch (error) {
    // `supportTag` is uniquely indexed on (teamId, name) - two concurrent
    // creates can both pass a pre-check and one still fails, so the
    // constraint is the real arbiter, not a SELECT before the insert.
    if (isUniqueViolation(error)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'A tag with this name already exists in this team'),
      })
    }
    throw error
  }
})
