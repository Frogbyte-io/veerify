/**
 * @openapi
 * /api/support/teams/{teamId}/csat-summary:
 *   get:
 *     tags: [Support]
 *     summary: Summarize rated CSAT responses
 *     operationId: getSupportCsatSummary
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: inboxId
 *         schema: { type: string }
 *     responses:
 *       200: { description: CSAT score summary }
 *       403: { description: Not a support agent on this team }
 */
import { and, eq, gte, isNotNull, lt } from 'drizzle-orm'
import { z } from 'zod'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireSupportTeamRole } from '~/server/utils/support-access'
import { validateQuery } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { conversation, csatResponse, csatSurvey, supportInbox } from '~/server/database/schema/support'
import { user } from '~/server/database/schema/auth'
import { summarizeCsatRows } from '~/server/utils/csat-reporting'

const querySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    inboxId: z.string().min(1).optional(),
  })
  .superRefine((query, context) => {
    if (query.from && query.to && query.from > query.to) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'to must be on or after from' })
    }
  })

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

function endOfUtcDay(value: Date): Date {
  const next = startOfUtcDay(value)
  next.setUTCDate(next.getUTCDate() + 1)
  return next
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const teamId = getRouterParam(event, 'teamId') as string
  await requireSupportTeamRole(teamId, session.user.id, 'agent')
  const query = validateQuery(event, querySchema)

  const from = query.from ? startOfUtcDay(query.from) : new Date(Date.now() - 30 * 24 * 60 * 60_000)
  const to = query.to ? endOfUtcDay(query.to) : new Date()
  const conditions = [
    eq(csatSurvey.teamId, teamId),
    eq(conversation.teamId, teamId),
    isNotNull(csatResponse.rating),
    gte(csatResponse.respondedAt, from),
    lt(csatResponse.respondedAt, to),
  ]
  if (query.inboxId) conditions.push(eq(conversation.inboxId, query.inboxId))

  const rows = await db
    .select({
      rating: csatResponse.rating,
      scale: csatSurvey.scale,
      inboxId: conversation.inboxId,
      inboxName: supportInbox.name,
      agentUserId: csatResponse.agentUserId,
      agentName: user.name,
      respondedAt: csatResponse.respondedAt,
    })
    .from(csatResponse)
    .innerJoin(csatSurvey, eq(csatSurvey.id, csatResponse.surveyId))
    .innerJoin(conversation, eq(conversation.id, csatResponse.conversationId))
    .innerJoin(supportInbox, eq(supportInbox.id, conversation.inboxId))
    .leftJoin(user, eq(user.id, csatResponse.agentUserId))
    .where(and(...conditions))

  return createSuccessResponse({
    from,
    to,
    ...summarizeCsatRows(
      rows
        .filter(
          (row): row is typeof row & { rating: number; respondedAt: Date } =>
            row.rating !== null && row.respondedAt !== null
        )
        .map((row) => ({ ...row, rating: row.rating as number, respondedAt: row.respondedAt as Date }))
    ),
  })
})
