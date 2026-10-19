/**
 * @openapi
 * /api/support/teams/{teamId}/automation-rules:
 *   get:
 *     tags: [Support]
 *     summary: List support automation rules
 *     operationId: listSupportAutomationRules
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Automation rules }
 *       403: { description: Not a member of the team }
 */
import { asc, eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireTeamAdmin } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { automationRule } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const teamId = getRouterParam(event, 'teamId') as string
  await requireTeamAdmin(teamId, session.user.id)

  const rules = await db
    .select()
    .from(automationRule)
    .where(eq(automationRule.teamId, teamId))
    .orderBy(asc(automationRule.sortOrder), asc(automationRule.createdAt), asc(automationRule.id))

  return createSuccessResponse({ rules })
})
