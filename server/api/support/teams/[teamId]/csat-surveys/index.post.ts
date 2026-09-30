/**
 * @openapi
 * /api/support/teams/{teamId}/csat-surveys:
 *   post:
 *     tags: [Support]
 *     summary: Create a team CSAT survey
 *     operationId: createSupportCsatSurvey
 *     responses:
 *       200: { description: CSAT survey created }
 *       400: { description: Invalid survey or inbox scope }
 *       403: { description: Team administrator required }
 */
import { randomUUID } from 'node:crypto'
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
    name: z.string().trim().min(1).max(160),
    scale: z.enum(['csat_5', 'thumbs', 'nps_10']),
    question: z.string().trim().min(1).max(500),
    followUpQuestion: z.string().trim().max(500).nullable().optional(),
    sendTrigger: z.enum(['on_resolve', 'on_close']),
    delayMinutes: z.number().int().min(0).max(43_200).default(0),
    contactCooldownMinutes: z.number().int().min(0).max(525_600).default(43_200),
    isEnabled: z.boolean().default(false),
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
  await requireTeamAdmin(teamId, session.user.id)
  const body = await validateBody(event, bodySchema)

  if (body.inboxId) {
    const [ownedInbox] = await db
      .select({ id: supportInbox.id })
      .from(supportInbox)
      .where(and(eq(supportInbox.id, body.inboxId), eq(supportInbox.teamId, teamId)))
      .limit(1)
    if (!ownedInbox) invalidInbox()
  }

  const now = new Date()
  const [survey] = await db
    .insert(csatSurvey)
    .values({
      id: randomUUID(),
      teamId,
      inboxId: body.inboxId ?? null,
      name: body.name,
      scale: body.scale as CsatScale,
      question: body.question,
      followUpQuestion: body.followUpQuestion ?? null,
      sendTrigger: body.sendTrigger as CsatSendTrigger,
      delayMinutes: body.delayMinutes,
      contactCooldownMinutes: body.contactCooldownMinutes,
      isEnabled: body.isEnabled,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  return createSuccessResponse({ survey })
})
