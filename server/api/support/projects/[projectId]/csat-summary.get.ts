/**
 * @openapi
 * /api/support/projects/{projectId}/csat-summary:
 *   get:
 *     tags: [Support]
 *     summary: Summarize rated CSAT responses
 *     operationId: getSupportCsatSummary
 *     parameters:
 *       - in: path
 *         name: projectId
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
 *       403: { description: Not a support agent on this project }
 */
import { and, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm'
import { z } from 'zod'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxAccess, requireSupportProjectRole } from '~/server/utils/support-access'
import { validateQuery } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import {
  conversation,
  csatResponse,
  csatSurvey,
  supportInbox,
  supportInboxMember,
  supportProjectSettings,
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
  const projectId = getRouterParam(event, 'projectId') as string
  const projectAccess = await requireSupportProjectRole(projectId, session.user.id, 'agent')
  const query = validateQuery(event, querySchema)

  const requestedInboxAccess = query.inboxId ? await requireInboxAccess(query.inboxId, session.user.id) : undefined
  const inboxScope = resolveCsatInboxScope({
    projectId,
    userId: session.user.id,
    projectAccess,
    requestedInboxId: query.inboxId,
    requestedInboxProjectId: requestedInboxAccess?.projectId,
  })

  const [settings] = await db
    .select({ reportingTimezone: supportProjectSettings.reportingTimezone })
    .from(supportProjectSettings)
    .where(eq(supportProjectSettings.projectId, projectId))
  const reportingTimezone = settings?.reportingTimezone ?? 'UTC'
  let from: Date
  let to: Date
  try {
    const fromDate = query.from
      ? query.from.toISOString().slice(0, 10)
      : reportingDateAt(new Date(Date.now() - 29 * 24 * 60 * 60_000), reportingTimezone)
    const toDate = query.to ? query.to.toISOString().slice(0, 10) : reportingDateAt(new Date(), reportingTimezone)
    from = reportingDayBounds(fromDate, reportingTimezone).start
    to = reportingDayBounds(toDate, reportingTimezone).end
  } catch (error) {
    if (error instanceof RangeError) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid reporting date range',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Invalid reporting date range'),
      })
    }
    throw error
  }
  const conditions = [
    eq(csatSurvey.projectId, projectId),
    eq(conversation.projectId, projectId),
    eq(supportInbox.projectId, projectId),
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
      .where(and(eq(supportInbox.projectId, inboxScope.projectId), eq(supportInboxMember.userId, inboxScope.userId)))
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
