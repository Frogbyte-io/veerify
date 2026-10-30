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
 *       message atomically claims an unassigned conversation for the replying
 *       agent, writes the matching activity, and enqueues the durable outbox
 *       delivery in the same transaction; a `note` never claims or dispatches
 *       mail.
 *
 *       Three optional fields apply to `outgoing` messages only (400 for a
 *       note). `fromAddressId` sends the reply from one of the inbox's own
 *       addresses instead of the default (see `canSendFrom` on
 *       `GET /api/support/inboxes/{id}/addresses`); the project sender policy
 *       still applies. `behaviour` turns the conversation into plain mail or a
 *       support case in the same transaction as the message, with the effects
 *       of `PATCH /api/support/conversations/{id}`; if the reply is rejected
 *       the type is not changed. `resolve` sets the status to `resolved` after
 *       the message is committed, as that PATCH would. The response carries
 *       `resolved: true` when it did, and `false` when `resolve` was not
 *       requested, the conversation was already resolved, or resolving failed
 *       (the message is sent either way).
 *     operationId: createSupportConversationMessage
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [kind, body]
 *             properties:
 *               kind: { type: string, enum: [outgoing, note] }
 *               body: { type: string, minLength: 1, maxLength: 50000 }
 *               bodyHtml: { type: string, maxLength: 200000 }
 *               attachments:
 *                 type: array
 *                 maxItems: 10
 *                 items:
 *                   type: object
 *                   required: [uploadId]
 *                   properties:
 *                     uploadId: { type: string }
 *               fromAddressId: { type: string, description: "A custom, non-catch-all address of this inbox on a verified project email domain; outgoing only" }
 *               behaviour: { type: string, enum: [mail, helpdesk], description: "Turn the conversation into plain mail or a support case with this reply; outgoing only" }
 *               resolve: { type: boolean, description: "Resolve the conversation after sending; outgoing only" }
 *     responses:
 *       200: { description: "Message created: `{ message, resolved }`" }
 *       400: { description: "Validation failed, `fromAddressId` cannot be used to send from, or `fromAddressId`, `behaviour` or `resolve` on a note" }
 *       403: { description: Not a member of this inbox or a project admin }
 *       404: { description: Conversation not found }
 *       409: { description: "The inbox has no sending address, the contact has no email address, or (project sender policy) the inbox's From address is on a domain the project has not verified (SENDER_NOT_VERIFIED)" }
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
  resolveConversationSender,
  resolveSendFromAddress,
  SEND_FROM_REJECTION_MESSAGES,
} from '~/server/utils/conversation-sender'
import {
  announceConversationUpdated,
  applyBehaviourSwitch,
  planBehaviourSwitch,
  updateConversation,
  type BehaviourSwitchPlan,
} from '~/server/utils/conversation-update'
import {
  contact,
  conversation,
  conversationMessage,
  conversationParticipant,
  supportInbox,
} from '~/server/database/schema/support'
import { emailDomain, parseReferences } from '~/server/services/support-channels/types'
import { buildOutgoingReply } from '~/server/utils/outbound-reply'
import { runOutboundDeliveryWorker } from '~/server/utils/outbound-delivery'
import { isSenderAllowedForProject } from '~/server/utils/sender-enforcement'
import { triggerAutomationEvent } from '~/server/utils/automation-engine'
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
    fromAddressId: z.string().min(1).optional(),
    behaviour: z.enum(['mail', 'helpdesk']).optional(),
    resolve: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    // These only mean something for a reply a customer receives.
    if (value.kind === 'note') {
      for (const field of ['fromAddressId', 'behaviour', 'resolve'] as const) {
        if (value[field] !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `A note cannot set ${field} - it is never sent`,
          })
        }
      }
    }

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
  // The type switch the reply asks for, applied in the commit transaction.
  let behaviourSwitch: BehaviourSwitchPlan | null = null
  const switchTime = new Date()

  if (isOutgoing) {
    const [inbox] = await db.select().from(supportInbox).where(eq(supportInbox.id, existing.inboxId)).limit(1)
    // An address the agent picked, when it qualifies; otherwise the address
    // the conversation arrived on when it is one of the project's verified
    // addresses, otherwise the inbox's sending address.
    let chosenAddress: string | null = null
    if (body.fromAddressId) {
      const chosen = await resolveSendFromAddress(body.fromAddressId, existing.inboxId)
      if (!chosen.ok) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Bad Request',
          data: createErrorResponse(ErrorCode.VALIDATION_ERROR, SEND_FROM_REJECTION_MESSAGES[chosen.reason]),
        })
      }
      chosenAddress = chosen.address
    }
    const senderAddress =
      chosenAddress ??
      (inbox
        ? await resolveConversationSender({
            inboxId: inbox.id,
            inboxEmailAddress: inbox.emailAddress,
            mailAddressId: existing.mailAddressId,
          })
        : null)

    // Settings surfaces this before an agent gets here (SUP-04-6); this is
    // the backstop for the case that slipped through - failing loudly here
    // beats silently queuing a delivery that can never send.
    if (!inbox || !senderAddress) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(ErrorCode.CONFLICT, 'This inbox has no sending address configured'),
      })
    }

    // Project sender policy (design §4.5). Checked before anything is reserved or
    // written so a blocked reply leaves no half-finished state. Never blocks
    // under the legacy policy.
    if (!(await isSenderAllowedForProject(existing.projectId, senderAddress))) {
      const senderDomain = emailDomain(senderAddress) ?? senderAddress
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        data: createErrorResponse(
          'SENDER_NOT_VERIFIED',
          `Replies from ${senderAddress} are blocked until ${senderDomain} is verified in Project settings → Email`
        ),
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

    if (body.behaviour) behaviourSwitch = await planBehaviourSwitch(existing, body.behaviour, switchTime)

    // Reserve only after every request-time prerequisite above has passed.
    // This prevents an inbox/contact/threading conflict from leaving an
    // otherwise valid upload stranded in `finalizing`.
    reservation = await reserveAttachmentFinalization({
      uploadIds: (body.attachments ?? []).map((attachment) => attachment.uploadId),
      conversationId,
      userId: session.user.id,
    })

    const domain = emailDomain(senderAddress) ?? emailDomain(process.env.MAIL_FROM ?? '') ?? 'localhost'

    try {
      outgoing = buildOutgoingReply({
        inbox: { emailAddress: senderAddress, fromName: inbox.fromName, signature: inbox.signature },
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
                  : (inbox.fromName ?? 'Support Project'),
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
    beforeMessage: behaviourSwitch
      ? (tx) => applyBehaviourSwitch(tx, existing, behaviourSwitch as BehaviourSwitchPlan, session.user.id, switchTime)
      : undefined,
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
    projectId: existing.projectId,
    inboxId: existing.inboxId,
    conversationId,
    messageId: created.id,
  })
  if (behaviourSwitch && !body.resolve) await announceConversationUpdated(existing, session.user.id)
  await triggerAutomationEvent({
    conversationId,
    trigger: 'message_created',
    actorUserId: session.user.id,
  })

  // Resolve after the reply is committed, through the same path as a PATCH. The
  // reply is already sent, so a failure here is logged rather than turned into
  // an error a client would answer by sending the reply again.
  let resolved = false
  if (isOutgoing && body.resolve) {
    try {
      const [fresh] = await db.select().from(conversation).where(eq(conversation.id, conversationId)).limit(1)
      if (fresh) {
        const result = await updateConversation({
          existing: fresh,
          patch: { status: 'resolved' },
          actor: session.user,
        })
        resolved = result.changed
      }
    } catch (error) {
      logger.error('Resolving the conversation after a reply failed', {
        error: error instanceof Error ? error.message : error,
      })
    }
  }

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

  return createSuccessResponse({ message: created, resolved })
})
