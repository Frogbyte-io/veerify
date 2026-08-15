/**
 * @openapi
 * /api/support/inboxes/{id}/addresses:
 *   post:
 *     tags: [Support]
 *     summary: Add a receiving address to an inbox
 *     description: >
 *       Address matching in resolveInboxByAddress is case-insensitive, so the
 *       address is normalized to lowercase on write - two rows differing only
 *       by case would otherwise both silently match the same inbound mail.
 *       isPrimary is exclusive: setting it clears the flag on the inbox's
 *       other addresses in the same transaction (not specified in
 *       design.md - a self-consistent reading of "primary" implying one).
 *     operationId: createSupportInboxAddress
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Address created }
 *       400: { description: projectId does not belong to this team }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Inbox not found }
 *       409: { description: This address is already in use }
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
import { supportInboxAddress } from '~/server/database/schema/support'
import { project } from '~/server/database/schema/feedback'

const bodySchema = z.object({
  address: z.string().trim().toLowerCase().email().max(320),
  projectId: z.string().optional(),
  isPrimary: z.boolean().optional().default(false),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const inboxId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)

  const inbox = await requireInboxAccess(inboxId, session.user.id)

  if (body.projectId) {
    const [matchedProject] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, body.projectId), eq(project.teamId, inbox.teamId)))
      .limit(1)

    if (!matchedProject) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Project is not part of this team'),
      })
    }
  }

  try {
    return await db.transaction(async (tx) => {
      if (body.isPrimary) {
        await tx
          .update(supportInboxAddress)
          .set({ isPrimary: false })
          .where(eq(supportInboxAddress.inboxId, inboxId))
      }

      const [created] = await tx
        .insert(supportInboxAddress)
        .values({
          id: randomUUID(),
          inboxId,
          address: body.address,
          projectId: body.projectId ?? null,
          isPrimary: body.isPrimary,
          createdAt: new Date(),
        })
        .returning()

      return createSuccessResponse({ address: created })
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'This address is already in use'),
      })
    }
    throw error
  }
})
