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
 *       reply is the worst failure mode in a support tool. An `outgoing`
 *       message is enqueued to the durable outbox in the same transaction as
 *       its insert (SUP-04-4); a `note` never dispatches mail (SUP-04-5).
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
 *       409: { description: The inbox has no sending address, or the contact has no email address }
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { createConsola } from 'consola'
import { createError } from 'h3'
import { createSuccessResponse, createErrorResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { publishConversationEvent } from '~/server/utils/support-realtime'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import {
  contact,
  conversation,
  conversationAttachment,
  conversationMessage,
  conversationParticipant,
  supportInbox,
} from '~/server/database/schema/support'
import { emailDomain, parseReferences } from '~/server/services/support-channels/types'
import { buildOutgoingReply, totalAttachmentBytes } from '~/server/utils/outbound-reply'
import { enqueueOutboundDelivery, runOutboundDeliveryWorker } from '~/server/utils/outbound-delivery'
import { MAX_MESSAGE_ATTACHMENT_BYTES } from '~/server/utils/support-attachments'

const logger = createConsola().withTag('veerify').withTag('support-outbound')

// Matches the composer's POST body exactly (`components/support/SupportComposer.vue`)
// and SUP-04-7's presign response shape (`storageKey`, `fileName`, `contentType`,
// `sizeBytes`) - no `cid`, since this composer has no inline-image insertion.
const attachmentSchema = z.object({
  storageKey: z.string().min(1),
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
})

const bodySchema = z
  .object({
    kind: z.enum(['outgoing', 'note']),
    body: z.string().trim().min(1).max(50000),
    bodyHtml: z.string().max(200000).optional(),
    // Count bound only - a defensive limit on this endpoint, independent of
    // SUP-04-7's per-file size cap (enforced at presign) and this endpoint's
    // own per-message total cap (enforced below, against MAX_MESSAGE_ATTACHMENT_BYTES).
    attachments: z.array(attachmentSchema).max(10).optional(),
  })
  .superRefine((value, ctx) => {
    // A note has no external recipient, so an attached file would be
    // silently dropped rather than sent - reject rather than let that
    // surprise whoever builds the composer UI.
    if (value.kind === 'note' && value.attachments && value.attachments.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attachments'],
        message: 'A note cannot have attachments - it is never sent',
      })
    }

    // SUP-04-7's presign step caps each file individually and cannot see the
    // others in the same reply - this is the first point that sees the full
    // list, so the per-message total is enforced here (parallel-agents.md).
    const totalBytes = totalAttachmentBytes(value.attachments)
    if (totalBytes > MAX_MESSAGE_ATTACHMENT_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attachments'],
        message: `Attachments total ${Math.floor(totalBytes / (1024 * 1024))} MB, exceeding the ${Math.floor(MAX_MESSAGE_ATTACHMENT_BYTES / (1024 * 1024))} MB per-message limit`,
      })
    }
  })

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string
  const body = await validateBody(event, bodySchema)

  const existing = await requireConversationAccess(conversationId, session.user.id)

  const isPrivate = body.kind === 'note'
  const isOutgoing = body.kind === 'outgoing'
  const now = new Date()
  const newMessageId = randomUUID()

  // Everything the outbox payload needs, resolved before the transaction so
  // a failure here (no sending address) never leaves a half-written message.
  let outgoing: ReturnType<typeof buildOutgoingReply> | null = null

  if (isOutgoing) {
    const [inbox] = await db.select().from(supportInbox).where(eq(supportInbox.id, existing.inboxId)).limit(1)

    // Settings surfaces this before an agent gets here (SUP-04-6); this is
    // the backstop for the case that slipped through - failing loudly here
    // beats silently queuing a delivery that can never send.
    if (!inbox?.emailAddress) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'This inbox has no sending address configured'),
      })
    }

    const [contactRow] = await db.select().from(contact).where(eq(contact.id, existing.contactId)).limit(1)

    // `contact.email` is nullable in the schema (future channels identify by
    // other means) - for this email-only stage, a contact with no email is a
    // real, reachable state that must not silently become `to: ''`.
    if (!contactRow?.email) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'This conversation contact has no email address'),
      })
    }

    const ccParticipants = await db
      .select({ contactId: conversationParticipant.contactId })
      .from(conversationParticipant)
      .where(and(eq(conversationParticipant.conversationId, conversationId), eq(conversationParticipant.role, 'cc')))

    const ccContactIds = ccParticipants.map((p) => p.contactId).filter((id): id is string => id !== null)
    const ccContacts =
      ccContactIds.length > 0 ? await db.select().from(contact).where(inArray(contact.id, ccContactIds)) : []

    const [previousMessage] = await db
      .select()
      .from(conversationMessage)
      .where(
        and(
          eq(conversationMessage.conversationId, conversationId),
          inArray(conversationMessage.kind, ['incoming', 'outgoing']),
          isNotNull(conversationMessage.channelMessageId)
        )
      )
      .orderBy(desc(conversationMessage.createdAt))
      .limit(1)

    const domain = emailDomain(inbox.emailAddress) ?? emailDomain(process.env.MAIL_FROM ?? '') ?? 'localhost'

    outgoing = buildOutgoingReply({
      inbox: { emailAddress: inbox.emailAddress, fromName: inbox.fromName, signature: inbox.signature },
      contact: { email: contactRow.email, name: contactRow.name },
      cc: ccContacts.filter((c) => c.email).map((c) => ({ email: c.email as string })),
      subject: existing.subject ?? '(no subject)',
      agentBody: body.body,
      agentBodyHtml: body.bodyHtml ?? null,
      previous: previousMessage
        ? {
            channelMessageId: previousMessage.channelMessageId as string,
            references: parseReferences(
              (previousMessage.channelHeaders as Record<string, string> | null)?.references ?? null
            ),
            fromName:
              previousMessage.senderKind === 'contact'
                ? (contactRow.name ?? contactRow.email ?? 'Customer')
                : (inbox.fromName ?? 'Support Team'),
            sentAt: previousMessage.createdAt,
            body: previousMessage.body ?? '',
            bodyHtml: previousMessage.bodyHtml,
          }
        : null,
      newMessageId,
      domain,
      attachments: (body.attachments ?? []).map((a) => ({
        filename: a.fileName,
        contentType: a.contentType,
        storageKey: a.storageKey,
      })),
    })
  }

  const created = await db.transaction(async (tx) => {
    const [message] = await tx
      .insert(conversationMessage)
      .values({
        id: newMessageId,
        conversationId,
        kind: body.kind,
        body: body.body,
        bodyHtml: body.bodyHtml ?? null,
        senderKind: 'agent',
        senderContactId: null,
        senderUserId: session.user.id,
        isPrivate,
        channelMessageId: outgoing?.channelMessageId ?? null,
        inReplyTo: outgoing?.inReplyTo ?? null,
        channelHeaders: outgoing?.referencesForStorage ? { references: outgoing.referencesForStorage } : null,
        // A note is never sent, so it has nothing to deliver; 'sent' would be
        // a lie and 'pending' would dangle forever with nothing to claim it.
        deliveryStatus: isOutgoing ? 'pending' : 'delivered',
        createdAt: now,
      })
      .returning()

    if (isOutgoing && body.attachments && body.attachments.length > 0) {
      await tx.insert(conversationAttachment).values(
        body.attachments.map((a) => ({
          id: randomUUID(),
          messageId: message.id,
          storageKey: a.storageKey,
          fileName: a.fileName,
          contentType: a.contentType,
          sizeBytes: a.sizeBytes,
          // Never inline: this composer has no inline-image insertion, unlike
          // Stage 03's inbound path where a customer's HTML email embeds them.
          isInline: false,
          contentId: null,
          createdAt: now,
        }))
      )
    }

    const conversationUpdates: Partial<typeof conversation.$inferInsert> = {
      lastActivityAt: now,
      updatedAt: now,
    }

    // A private note is not a reply to the customer, so it must not touch
    // either of these - only `outgoing` counts as a response.
    if (isOutgoing) {
      conversationUpdates.lastAgentReplyAt = now
      // Stage 06's SLA metrics read `firstResponseAt`, so it is captured here
      // on the first outgoing reply and never overwritten after that.
      if (!existing.firstResponseAt) {
        conversationUpdates.firstResponseAt = now
      }
    }

    await tx.update(conversation).set(conversationUpdates).where(eq(conversation.id, conversationId))

    // Enqueue inside the same transaction as the message insert, per delta
    // D-21: a message must never exist without something that will attempt
    // to send it. `kind: 'note'` never reaches here (SUP-04-5) - `isOutgoing`
    // gates this whole block.
    if (isOutgoing && outgoing) {
      await enqueueOutboundDelivery(tx, { messageId: message.id, payload: outgoing.deliveryPayload })
    }

    return message
  })

  // Published after the transaction commits, never inside it - the agent UI
  // must not wait on SMTP (design.md).
  await publishConversationEvent({
    type: 'message.created',
    teamId: existing.teamId,
    inboxId: existing.inboxId,
    conversationId,
    messageId: created.id,
  })

  // Fire-and-forget: the response must not wait on SMTP either. The outbox
  // row is the durable copy - if this invocation dies before the worker
  // finishes, the row is still there, `pending`, for the next trigger to
  // claim (a scheduled sweep is Stage 06+ infrastructure; until then, every
  // send attempt piggybacks on the next reply that happens to trigger this).
  if (isOutgoing) {
    runOutboundDeliveryWorker().catch((error) => {
      logger.error('Outbound delivery worker pass failed', {
        error: error instanceof Error ? error.message : error,
      })
    })
  }

  return createSuccessResponse({ message: created })
})
