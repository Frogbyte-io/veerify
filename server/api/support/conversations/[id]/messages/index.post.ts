/**
 * @openapi
 * /api/support/conversations/{id}/messages:
 *   post:
 *     tags: [Support]
 *     summary: Write an agent reply or an internal note to a conversation
 *     description: >
 *       Only `outgoing` (customer-visible reply) and `note` (internal-only)
 *       kinds may be created here - `incoming` is written by the mail
 *       pipeline and `activity` by the system, never by an agent directly.
 *       `isPrivate` is derived from `kind` server-side and is never taken
 *       from the request body, since a private note rendered as a public
 *       reply is the worst failure mode in a support tool. Stage 02 only
 *       stores the message; Stage 04 is responsible for actually sending it,
 *       so `deliveryStatus` starts at `pending`.
 *     operationId: createSupportConversationMessage
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Message created }
 *       400: { description: Validation failed }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Conversation not found }
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { publishConversationEvent } from '~/server/utils/support-realtime'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { conversation, conversationMessage } from '~/server/database/schema/support'

const bodySchema = z.object({
  kind: z.enum(['outgoing', 'note']),
  body: z.string().trim().min(1).max(50000),
  bodyHtml: z.string().max(200000).optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)

  const existing = await requireConversationAccess(conversationId, session.user.id)

  const isPrivate = body.kind === 'note'
  const now = new Date()

  const created = await db.transaction(async (tx) => {
    const [message] = await tx
      .insert(conversationMessage)
      .values({
        id: randomUUID(),
        conversationId,
        kind: body.kind,
        body: body.body,
        bodyHtml: body.bodyHtml ?? null,
        senderKind: 'agent',
        senderContactId: null,
        senderUserId: session.user.id,
        isPrivate,
        // Stage 02 only stores replies - Stage 04 owns actually sending them.
        deliveryStatus: 'pending',
        createdAt: now,
      })
      .returning()

    const conversationUpdates: Partial<typeof conversation.$inferInsert> = {
      lastActivityAt: now,
      updatedAt: now,
    }

    // A private note is not a reply to the customer, so it must not touch
    // either of these - only `outgoing` counts as a response.
    if (body.kind === 'outgoing') {
      conversationUpdates.lastAgentReplyAt = now
      // Stage 06's SLA metrics read `firstResponseAt`, so it is captured here
      // on the first outgoing reply and never overwritten after that.
      if (!existing.firstResponseAt) {
        conversationUpdates.firstResponseAt = now
      }
    }

    await tx.update(conversation).set(conversationUpdates).where(eq(conversation.id, conversationId))

    return message
  })

  // Published after the transaction commits, never inside it.
  await publishConversationEvent({
    type: 'message.created',
    teamId: existing.teamId,
    inboxId: existing.inboxId,
    conversationId,
    messageId: created.id,
  })

  return createSuccessResponse({ message: created })
})
