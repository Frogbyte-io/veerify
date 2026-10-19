/**
 * @openapi
 * /api/support/canned-responses:
 *   post:
 *     tags: [Support]
 *     summary: Create a team canned response
 *     operationId: createSupportCannedResponse
 *     responses:
 *       200: { description: Canned response created }
 *       400: { description: Validation failed }
 *       403: { description: Not a member of the team }
 *       409: { description: This shortcode is already in use for the team }
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireTeamMembership } from '~/server/utils/support-access'
import { isUniqueViolation } from '~/server/utils/support-errors'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { cannedResponse } from '~/server/database/schema/support'

const shortcodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_-]+$/, 'Shortcode may contain lowercase letters, numbers, underscores, and hyphens')

const bodySchema = z
  .object({
    teamId: z.string().min(1),
    shortcode: shortcodeSchema,
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(50000),
  })
  .strict()

function duplicateShortcodeError(): never {
  throw createError({
    statusCode: 409,
    statusMessage: 'Conflict',
    data: createErrorResponse(ErrorCode.CONFLICT, 'This shortcode is already in use for the team'),
  })
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await validateBody(event, bodySchema)

  await requireTeamMembership(body.teamId, session.user.id)

  const now = new Date()

  try {
    const [created] = await db
      .insert(cannedResponse)
      .values({
        id: randomUUID(),
        teamId: body.teamId,
        shortcode: body.shortcode,
        title: body.title,
        body: body.body,
        createdByUserId: session.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    return createSuccessResponse({ cannedResponse: created })
  } catch (error) {
    if (isUniqueViolation(error, 'canned_response_team_shortcode_idx')) duplicateShortcodeError()
    throw error
  }
})
