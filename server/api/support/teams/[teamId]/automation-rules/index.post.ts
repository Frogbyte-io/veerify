/**
 * @openapi
 * /api/support/teams/{teamId}/automation-rules:
 *   post:
 *     tags: [Support]
 *     summary: Create a support automation rule
 *     operationId: createSupportAutomationRule
 *     responses:
 *       200: { description: Automation rule created }
 *       400: { description: Invalid rule or inbox scope }
 *       403: { description: Team administrator required }
 */
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { z } from 'zod'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireTeamAdmin } from '~/server/utils/support-access'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { automationRule, supportInbox, type AutomationConditionGroup } from '~/server/database/schema/support'

const actionSchema = z.object({ type: z.string().trim().min(1).max(80) }).passthrough()
const conditionsSchema = z
  .object({ all: z.array(z.unknown()).optional(), any: z.array(z.unknown()).optional() })
  .passthrough()
const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    inboxId: z.string().min(1).nullable().optional(),
    trigger: z.enum(['conversation_created', 'conversation_updated', 'message_created', 'time_based']),
    conditions: conditionsSchema.default({}),
    actions: z.array(actionSchema).max(50).default([]),
    isEnabled: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(100000).default(0),
  })
  .strict()

function invalidInbox(): never {
  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Inbox is not part of this team'),
  })
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const teamId = getRouterParam(event, 'teamId') as string
  await requireTeamAdmin(teamId, session.user.id)
  const body = await validateBody(event, bodySchema)

  if (body.inboxId) {
    const [ownedInbox] = await db
      .select({ id: supportInbox.id })
      .from(supportInbox)
      .where(and(eq(supportInbox.id, body.inboxId), eq(supportInbox.teamId, teamId)))
      .limit(1)
    if (!ownedInbox) invalidInbox()
  }

  const now = new Date()
  const [rule] = await db
    .insert(automationRule)
    .values({
      id: randomUUID(),
      teamId,
      inboxId: body.inboxId ?? null,
      name: body.name,
      trigger: body.trigger,
      conditions: body.conditions as AutomationConditionGroup,
      actions: body.actions,
      isEnabled: body.isEnabled,
      sortOrder: body.sortOrder,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  return createSuccessResponse({ rule })
})
