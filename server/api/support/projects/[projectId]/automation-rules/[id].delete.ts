/**
 * @openapi
 * /api/support/projects/{projectId}/automation-rules/{id}:
 *   delete:
 *     tags: [Support]
 *     summary: Delete a support automation rule
 *     operationId: deleteSupportAutomationRule
 *     responses:
 *       200: { description: Automation rule deleted }
 *       403: { description: Project administrator required }
 *       404: { description: Rule not found }
 */
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireProjectAdmin } from '~/server/utils/project-access'
import { db } from '~/server/database/drizzle'
import { automationRule } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  const id = getRouterParam(event, 'id') as string
  await requireProjectAdmin(projectId, session.user.id)

  const deleted = await db
    .delete(automationRule)
    .where(and(eq(automationRule.id, id), eq(automationRule.projectId, projectId)))
    .returning({ id: automationRule.id })
  if (!deleted[0]) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Automation rule not found'),
    })
  }
  return createSuccessResponse({ deleted: true })
})
