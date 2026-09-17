/**
 * @openapi
 * /api/support/teams/{teamId}/csat-surveys/{id}:
 *   put:
 *     tags: [Support]
 *     summary: Update a team CSAT survey
 *     operationId: updateSupportCsatSurvey
 *     responses:
 *       200: { description: CSAT survey updated }
 *       400: { description: Invalid survey or inbox scope }
 *       403: { description: Team administrator required }
 *       404: { description: Survey not found }
 */
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { z } from 'zod'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireTeamAdmin } from '~/server/utils/support-access'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { csatSurvey, supportInbox, type CsatScale, type CsatSendTrigger } from '~/server/database/schema/support'

const bodySchema = z
  .object({
    inboxId: z.string().min(1).nullable().optional(),
    name: z.string().trim().min(1).max(160).optional(),
    scale: z.enum(['csat_5', 'thumbs', 'nps_10']).optional(),
    question: z.string().trim().min(1).max(500).optional(),
    followUpQuestion: z.string().trim().max(500).nullable().optional(),
    sendTrigger: z.enum(['on_resolve', 'on_close']).optional(),
    delayMinutes: z.number().int().min(0).max(43_200).optional(),
    contactCooldownMinutes: z.number().int().min(0).max(525_600).optional(),
    isEnabled: z.boolean().optional(),
  })
  .strict()

function invalidInbox(): never {
  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Inbox is not part of this team'),
  })
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const teamId = getRouterParam(event, 'teamId') as string
  const id = getRouterParam(event, 'id') as string
  await requireTeamAdmin(teamId, session.user.id)
  const body = await validateBody(event, bodySchema)

  const [existing] = await db
    .select({ id: csatSurvey.id })
    .from(csatSurvey)
    .where(and(eq(csatSurvey.id, id), eq(csatSurvey.teamId, teamId)))
    .limit(1)
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'CSAT survey not found'),
    })
  }

  if (body.inboxId) {
    const [ownedInbox] = await db
      .select({ id: supportInbox.id })
      .from(supportInbox)
      .where(and(eq(supportInbox.id, body.inboxId), eq(supportInbox.teamId, teamId)))
      .limit(1)
    if (!ownedInbox) invalidInbox()
  }

  const [survey] = await db
    .update(csatSurvey)
    .set({
      ...(body.inboxId !== undefined ? { inboxId: body.inboxId } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.scale !== undefined ? { scale: body.scale as CsatScale } : {}),
      ...(body.question !== undefined ? { question: body.question } : {}),
      ...(body.followUpQuestion !== undefined ? { followUpQuestion: body.followUpQuestion } : {}),
      ...(body.sendTrigger !== undefined ? { sendTrigger: body.sendTrigger as CsatSendTrigger } : {}),
      ...(body.delayMinutes !== undefined ? { delayMinutes: body.delayMinutes } : {}),
      ...(body.contactCooldownMinutes !== undefined ? { contactCooldownMinutes: body.contactCooldownMinutes } : {}),
      ...(body.isEnabled !== undefined ? { isEnabled: body.isEnabled } : {}),
      updatedAt: new Date(),
    })
    .where(eq(csatSurvey.id, id))
    .returning()
  return createSuccessResponse({ survey })
})
