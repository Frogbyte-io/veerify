/**
 * @openapi
 * /api/support/projects/{projectId}/automation-rules/dry-run:
 *   post:
 *     tags: [Support]
 *     summary: Dry-run support automation rules for a conversation
 *     operationId: dryRunSupportAutomationRules
 *     responses:
 *       200: { description: Dry-run action plan }
 *       400: { description: Conversation is not part of the project }
 *       403: { description: Not a member of the project }
 */
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { z } from 'zod'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxRole, requireSupportProjectRole } from '~/server/utils/support-access'
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
  const projectId = getRouterParam(event, 'projectId') as string
  await requireSupportProjectRole(projectId, session.user.id, 'agent')
  const body = await validateBody(event, bodySchema)

  const [matched] = await db
    .select({ id: conversation.id, inboxId: conversation.inboxId })
    .from(conversation)
    .where(and(eq(conversation.id, body.conversationId), eq(conversation.projectId, projectId)))
    .limit(1)
  if (!matched) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Conversation is not part of this project'),
    })
  }

  // Project-level support membership is not enough to inspect every inbox: an
  // agent may be assigned to only one of several inboxes in the project.
  await requireInboxRole(matched.inboxId, session.user.id, 'agent')

  const result = await runAutomationRules({
    conversationId: body.conversationId,
    trigger: body.trigger,
    dryRun: true,
    actorUserId: session.user.id,
  })
  return createSuccessResponse(result)
})
