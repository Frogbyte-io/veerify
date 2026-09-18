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
import { and, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm'
import { z } from 'zod'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxAccess, requireSupportTeamRole } from '~/server/utils/support-access'
import { validateQuery } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import {
  conversation,
  csatResponse,
  csatSurvey,
  supportInbox,
  supportInboxMember,
  supportTeamSettings,
} from '~/server/database/schema/support'
import { user } from '~/server/database/schema/auth'
import { summarizeCsatRows } from '~/server/utils/csat-reporting'
import { resolveCsatInboxScope } from '~/server/utils/csat-access'
import { reportingDayBounds, reportingDateAt } from '~/server/utils/support-reporting-calendar'

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

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const teamId = getRouterParam(event, 'teamId') as string
  const teamAccess = await requireSupportTeamRole(teamId, session.user.id, 'agent')
  const query = validateQuery(event, querySchema)

  const requestedInboxAccess = query.inboxId ? await requireInboxAccess(query.inboxId, session.user.id) : undefined
  const inboxScope = resolveCsatInboxScope({
    teamId,
    userId: session.user.id,
    teamAccess,
    requestedInboxId: query.inboxId,
    requestedInboxTeamId: requestedInboxAccess?.teamId,
  })

  const [settings] = await db
    .select({ reportingTimezone: supportTeamSettings.reportingTimezone })
    .from(supportTeamSettings)
    .where(eq(supportTeamSettings.teamId, teamId))
  const reportingTimezone = settings?.reportingTimezone ?? 'UTC'
  let from: Date
  let to: Date
  try {
    const fromDate = query.from
      ? query.from.toISOString().slice(0, 10)
      : reportingDateAt(new Date(Date.now() - 30 * 24 * 60 * 60_000), reportingTimezone)
    const toDate = query.to ? query.to.toISOString().slice(0, 10) : reportingDateAt(new Date(), reportingTimezone)
    from = reportingDayBounds(fromDate, reportingTimezone).start
    to = reportingDayBounds(toDate, reportingTimezone).end
  } catch (error) {
    if (error instanceof RangeError) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid reporting date range' })
    }
    throw error
  }
  const conditions = [
    eq(csatSurvey.teamId, teamId),
    eq(conversation.teamId, teamId),
    eq(supportInbox.teamId, teamId),
    isNotNull(csatResponse.rating),
    gte(csatResponse.respondedAt, from),
    lt(csatResponse.respondedAt, to),
  ]
  if (inboxScope.kind === 'explicit') {
    conditions.push(eq(conversation.inboxId, inboxScope.inboxId))
  } else if (inboxScope.kind === 'member') {
    const accessibleInboxIds = db
      .select({ id: supportInboxMember.inboxId })
      .from(supportInboxMember)
      .innerJoin(supportInbox, eq(supportInbox.id, supportInboxMember.inboxId))
      .where(and(eq(supportInbox.teamId, inboxScope.teamId), eq(supportInboxMember.userId, inboxScope.userId)))
    conditions.push(inArray(conversation.inboxId, accessibleInboxIds))
  }

  const rows = await db
    .select({
      rating: csatResponse.rating,
      scale: csatResponse.scale,
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
        .map((row) => ({ ...row, rating: row.rating as number, respondedAt: row.respondedAt as Date })),
      reportingTimezone
    ),
  })
})
