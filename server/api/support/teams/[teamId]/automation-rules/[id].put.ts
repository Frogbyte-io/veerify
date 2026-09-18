/**
 * @openapi
 * /api/support/teams/{teamId}/automation-rules/{id}:
 *   put:
 *     tags: [Support]
 *     summary: Update a support automation rule
 *     operationId: updateSupportAutomationRule
 *     responses:
 *       200: { description: Automation rule updated }
 *       400: { description: Invalid rule or inbox scope }
 *       403: { description: Team administrator required }
 *       404: { description: Rule not found }
 */
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { z } from 'zod'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireTeamAdmin } from '~/server/utils/support-access'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { automationRule, supportInbox, type AutomationConditionGroup } from '~/server/database/schema/support'
import { validateAutomationWebhookActions } from '~/server/utils/automation-webhook'

const actionSchema = z.object({ type: z.string().trim().min(1).max(80) }).passthrough()
const conditionsSchema = z
  .object({ all: z.array(z.unknown()).optional(), any: z.array(z.unknown()).optional() })
  .passthrough()
const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    inboxId: z.string().min(1).nullable().optional(),
    trigger: z.enum(['conversation_created', 'conversation_updated', 'message_created', 'time_based']).optional(),
    conditions: conditionsSchema.optional(),
    actions: z.array(actionSchema).max(50).optional(),
    isEnabled: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
  })
  .strict()

function badRequest(message: string): never {
  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    data: createErrorResponse(ErrorCode.VALIDATION_ERROR, message),
  })
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const teamId = getRouterParam(event, 'teamId') as string
  const id = getRouterParam(event, 'id') as string
  await requireTeamAdmin(teamId, session.user.id)
  const body = await validateBody(event, bodySchema)

  const [existing] = await db
    .select({ id: automationRule.id })
    .from(automationRule)
    .where(and(eq(automationRule.id, id), eq(automationRule.teamId, teamId)))
    .limit(1)
  if (!existing) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Automation rule not found'),
    })
  }

  if (body.inboxId) {
    const [ownedInbox] = await db
      .select({ id: supportInbox.id })
      .from(supportInbox)
      .where(and(eq(supportInbox.id, body.inboxId), eq(supportInbox.teamId, teamId)))
      .limit(1)
    if (!ownedInbox) badRequest('Inbox is not part of this team')
  }

  if (body.actions) {
    try {
      validateAutomationWebhookActions(body.actions)
    } catch (error) {
      badRequest(error instanceof Error ? error.message : 'Invalid webhook URL')
    }
  }

  const [rule] = await db
    .update(automationRule)
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.inboxId !== undefined ? { inboxId: body.inboxId } : {}),
      ...(body.trigger !== undefined ? { trigger: body.trigger } : {}),
      ...(body.conditions !== undefined ? { conditions: body.conditions as AutomationConditionGroup } : {}),
      ...(body.actions !== undefined ? { actions: body.actions } : {}),
      ...(body.isEnabled !== undefined ? { isEnabled: body.isEnabled } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      updatedAt: new Date(),
    })
    .where(eq(automationRule.id, id))
    .returning()

  return createSuccessResponse({ rule })
})
