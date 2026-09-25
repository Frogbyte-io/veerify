/**
 * @openapi
 * /api/support/teams/{teamId}/automation-rules/{id}/runs:
 *   get:
 *     tags: [Support]
 *     summary: List automation rule run history
 *     operationId: listSupportAutomationRuleRuns
 *     responses:
 *       200: { description: Automation rule run history }
 *       403: { description: Not a member of the team }
 *       404: { description: Rule not found }
 */
import { and, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireSupportTeamRole } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { automationRule, automationRuleRun } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const teamId = getRouterParam(event, 'teamId') as string
  const id = getRouterParam(event, 'id') as string
  await requireSupportTeamRole(teamId, session.user.id, 'agent')

  const [rule] = await db
    .select({ id: automationRule.id })
    .from(automationRule)
    .where(and(eq(automationRule.id, id), eq(automationRule.teamId, teamId)))
    .limit(1)
  if (!rule) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Automation rule not found'),
    })
  }

  const runs = await db
    .select()
    .from(automationRuleRun)
    .where(eq(automationRuleRun.ruleId, id))
    .orderBy(desc(automationRuleRun.createdAt))
    .limit(100)
  return createSuccessResponse({ runs })
})
