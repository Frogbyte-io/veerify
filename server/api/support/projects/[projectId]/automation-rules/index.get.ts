/**
 * @openapi
 * /api/support/projects/{projectId}/automation-rules:
 *   get:
 *     tags: [Support]
 *     summary: List support automation rules
 *     operationId: listSupportAutomationRules
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Automation rules }
 *       403: { description: Not a member of the project }
 */
import { asc, eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireProjectAdmin } from '~/server/utils/project-access'
import { db } from '~/server/database/drizzle'
import { automationRule } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  await requireProjectAdmin(projectId, session.user.id)

  const rules = await db
    .select()
    .from(automationRule)
    .where(eq(automationRule.projectId, projectId))
    .orderBy(asc(automationRule.sortOrder), asc(automationRule.createdAt), asc(automationRule.id))

  return createSuccessResponse({ rules })
})
