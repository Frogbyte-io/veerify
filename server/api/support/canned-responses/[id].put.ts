/**
 * @openapi
 * /api/support/canned-responses/{id}:
 *   put:
 *     tags: [Support]
 *     summary: Update a team canned response
 *     operationId: updateSupportCannedResponse
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Canned response updated }
 *       400: { description: Validation failed }
 *       403: { description: Not a member of the team }
 *       404: { description: Canned response not found }
 *       409: { description: This shortcode is already in use for the team }
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
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
    shortcode: shortcodeSchema.optional(),
    title: z.string().trim().min(1).max(160).optional(),
    body: z.string().trim().min(1).max(50000).optional(),
  })
  .strict()

function notFound(): never {
  throw createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    data: createErrorResponse(ErrorCode.NOT_FOUND, 'Canned response not found'),
  })
}

function duplicateShortcodeError(): never {
  throw createError({
    statusCode: 409,
    statusMessage: 'Conflict',
    data: createErrorResponse(ErrorCode.CONFLICT, 'This shortcode is already in use for the team'),
  })
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const responseId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)

  const [existing] = await db.select().from(cannedResponse).where(eq(cannedResponse.id, responseId)).limit(1)
  if (!existing) notFound()

  await requireTeamMembership(existing.teamId, session.user.id)

  try {
    const [updated] = await db
      .update(cannedResponse)
      .set({
        ...(body.shortcode !== undefined ? { shortcode: body.shortcode } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.body !== undefined ? { body: body.body } : {}),
        updatedAt: new Date(),
      })
      .where(eq(cannedResponse.id, responseId))
      .returning()

    return createSuccessResponse({ cannedResponse: updated })
  } catch (error) {
    if (isUniqueViolation(error, 'canned_response_team_shortcode_idx')) duplicateShortcodeError()
    throw error
  }
})
