/**
 * @openapi
 * /api/support/teams/{teamId}/automation-rules/dry-run:
 *   post:
 *     tags: [Support]
 *     summary: Dry-run support automation rules for a conversation
 *     operationId: dryRunSupportAutomationRules
 *     responses:
 *       200: { description: Dry-run action plan }
 *       400: { description: Conversation is not part of the team }
 *       403: { description: Not a member of the team }
 */
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { z } from 'zod'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireSupportTeamRole } from '~/server/utils/support-access'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { conversation } from '~/server/database/schema/support'
import { runAutomationRules } from '~/server/utils/automation-engine'

const bodySchema = z.object({
  conversationId: z.string().min(1),
  trigger: z
    .enum(['conversation_created', 'conversation_updated', 'message_created', 'time_based'])
    .default('conversation_created'),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const teamId = getRouterParam(event, 'teamId') as string
  await requireSupportTeamRole(teamId, session.user.id, 'agent')
  const body = await validateBody(event, bodySchema)

  const [matched] = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(and(eq(conversation.id, body.conversationId), eq(conversation.teamId, teamId)))
    .limit(1)
  if (!matched) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Conversation is not part of this team'),
    })
  }

  const result = await runAutomationRules({
    conversationId: body.conversationId,
    trigger: body.trigger,
    dryRun: true,
    actorUserId: session.user.id,
  })
  return createSuccessResponse(result)
})
