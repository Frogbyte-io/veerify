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
import { contact, conversationMessage, conversationParticipant, supportInbox } from '~/server/database/schema/support'
import { emailDomain, parseReferences } from '~/server/services/support-channels/types'
import { buildOutgoingReply } from '~/server/utils/outbound-reply'
import { runOutboundDeliveryWorker } from '~/server/utils/outbound-delivery'
import {
  commitMessageWithAttachments,
  markAttachmentCleanupRequired,
  reserveAttachmentFinalization,
  type AttachmentFinalizationReservation,
} from '~/server/utils/support-attachment-finalization'

const logger = createConsola().withTag('veerify').withTag('support-outbound')

// Attachment metadata is server-owned by the upload session and is never
// accepted again at message creation time.
const attachmentSchema = z
  .object({
    uploadId: z.string().min(1),
  })
  .strict()

const bodySchema = z
  .object({
    kind: z.enum(['outgoing', 'note']),
    body: z.string().trim().min(1).max(50000),
    bodyHtml: z.string().max(200000).optional(),
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

    const uploadIds = (value.attachments ?? []).map((attachment) => attachment.uploadId)
    if (new Set(uploadIds).size !== uploadIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attachments'],
        message: 'Duplicate attachment upload ids are not allowed',
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
  const newMessageId = randomUUID()
  let reservation: AttachmentFinalizationReservation[] = []

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

    // Reserve only after every request-time prerequisite above has passed.
    // This prevents an inbox/contact/threading conflict from leaving an
    // otherwise valid upload stranded in `finalizing`.
    reservation = await reserveAttachmentFinalization({
      uploadIds: (body.attachments ?? []).map((attachment) => attachment.uploadId),
      conversationId,
      userId: session.user.id,
    })

    const domain = emailDomain(inbox.emailAddress) ?? emailDomain(process.env.MAIL_FROM ?? '') ?? 'localhost'

    try {
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
        attachments: reservation.map((attachment) => ({
          filename: attachment.fileName,
          contentType: attachment.storedContentType,
          storageKey: attachment.finalStorageKey,
        })),
      })
    } catch (error) {
      await markAttachmentCleanupRequired(reservation, error)
      throw error
    }
  }

  const created = await commitMessageWithAttachments({
    reservation,
    conversationId,
    userId: session.user.id,
    existingConversation: existing,
    outgoing,
    message: {
      id: newMessageId,
      kind: body.kind,
      body: body.body,
      bodyHtml: body.bodyHtml ?? null,
      isPrivate,
      channelMessageId: outgoing?.channelMessageId ?? null,
      inReplyTo: outgoing?.inReplyTo ?? null,
      channelHeaders: outgoing?.referencesForStorage ? { references: outgoing.referencesForStorage } : null,
      deliveryStatus: isOutgoing ? 'pending' : 'delivered',
    },
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
  // finishes, the row is still there, `pending`, for the scheduler's next
  // recurring pass to claim.
  if (isOutgoing) {
    runOutboundDeliveryWorker().catch((error) => {
      logger.error('Outbound delivery worker pass failed', {
        error: error instanceof Error ? error.message : error,
      })
    })
  }

  return createSuccessResponse({ message: created })
})
