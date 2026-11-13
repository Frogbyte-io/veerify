/**
 * Filing one inbound customer message into an inbox: contact, conversation
 * (threaded or new), SLA, the message row, Cc participants and the auto-reply,
 * then realtime, automation and the outbox kick once committed.
 *
 * Shared by every channel that brings a customer's words into an inbox, so
 * they behave the same: inbound email (`server/api/support/inbound/[provider].post.ts`)
 * and website forms (`server/services/support-forms/submit.ts`). Each caller
 * owns what is specific to it (signature checks, event claims, duplicate
 * detection) and the transaction this runs in.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { db } from '~/server/database/drizzle'
import { emailDomain, type InboundMessage } from '~/server/services/support-channels'
import type { MailAddressBehaviour } from '~/lib/mail-address'
import { helpdeskAppliesTo } from '~/server/utils/conversation-behaviour'
import { allocateConversationDisplayId } from '~/server/utils/support-counter'
import { publishConversationEvent } from '~/server/utils/support-realtime'
import { resolveThread, updatesForInboundReply } from '~/server/utils/inbound-threading'
import { recordConversationActivity, recordConversationStatusEvent } from '~/server/utils/conversation-activity'
import { resolveCcParticipants, resolveOrCreateContact } from '~/server/utils/inbound-contacts'
import type { StoredAttachment } from '~/server/utils/inbound-attachments'
import { getRateLimitStore } from '~/server/services/rate-limit'
import {
  AUTO_REPLY_RATE_LIMIT_MAX,
  AUTO_REPLY_RATE_LIMIT_WINDOW_SECONDS,
  buildAutoReply,
  shouldSendAutoReply,
} from '~/server/utils/auto-reply'
import { enqueueOutboundDelivery, runOutboundDeliveryWorker } from '~/server/utils/outbound-delivery'
import { isSenderAllowedOrRecordBlock } from '~/server/utils/sender-enforcement'
import { reMarkConversationUnreadForIncoming } from '~/server/utils/conversation-read-state'
import {
  businessHours,
  contact,
  conversation,
  conversationAttachment,
  conversationMessage,
  conversationTag,
  slaPolicy,
} from '~/server/database/schema/support'
import { resolveSlaAssignment } from '~/server/utils/sla-assignment'
import { resolveConversationSender } from '~/server/utils/conversation-sender'
import { resumeSlaDeadlines } from '~/server/utils/sla-timers'
import { triggerAutomationEvent } from '~/server/utils/automation-engine'
import { createLogger } from '~/server/utils/logger'

// Same logger name as before the extraction, so existing log filters keep matching.
const logger = createLogger('support-inbound')

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface IntakeInbox {
  id: string
  projectId: string
  emailAddress: string | null
  fromName: string | null
  signature: string | null
  autoReplyEnabled: boolean
  autoReplyTemplate: string | null
}

export interface InboundIntakeInput {
  inbox: IntakeInbox
  /** The project address the message arrived on, recorded on a new conversation. Null for non-email channels. */
  mailAddressId: string | null
  /** Snapshotted onto a conversation this message opens. */
  behaviour: MailAddressBehaviour
  message: InboundMessage
  /** Plain-text body as stored (quote-stripped for email). */
  body: string
  /** Already sanitized HTML, or null. Never raw input. */
  bodyHtml: string | null
  /**
   * `thread`: reply onto an existing conversation when the headers or subject
   * match one (email). `new`: always open a new conversation (forms).
   */
  threading: 'thread' | 'new'
  /** The inbox's own addresses, so a support address in Cc never becomes a contact. */
  ownAddresses: Set<string>
  attachments: StoredAttachment[]
  /** Merged into the message row's metadata. */
  messageMetadata?: Record<string, unknown>
  /** Merged into a new conversation's metadata. */
  conversationMetadata?: Record<string, unknown>
  /**
   * The auto-reply to consider; defaults to the inbox's own setting. `quote:
   * false` leaves the inbound message out of the auto-reply and `subject`
   * replaces its subject: for channels where anyone can write both (website
   * forms), so the auto-reply cannot carry a stranger's text to the address
   * they typed in.
   */
  autoReply?: { enabled: boolean; template: string | null; quote?: boolean; subject?: string }
  /** Extra fields for log lines, e.g. the provider. */
  logContext?: Record<string, unknown>
}

export interface InboundIntakeResult {
  conversationId: string
  messageId: string
  contactId: string
  isNewConversation: boolean
  autoReplyMessageId: string | null
  /** Filed without reacting: no reopen, SLA, unread, auto-reply or automation. */
  quiet: boolean
}

/** Runs inside the caller's transaction; nothing here is visible until it commits. */
export async function fileInboundMessage(tx: Tx, input: InboundIntakeInput): Promise<InboundIntakeResult> {
  const { inbox, message } = input
  const logContext = input.logContext ?? {}

  // ---- Contact ------------------------------------------------------------
  const { contactId } = await resolveOrCreateContact(tx, inbox.projectId, message.from)

  // ---- Conversation -------------------------------------------------------
  const thread =
    input.threading === 'thread'
      ? await resolveThread(tx, { id: inbox.id, projectId: inbox.projectId }, message, contactId)
      : { conversationId: null, matchedBy: null }

  let conversationId = thread.conversationId
  let isNewConversation = false
  // Quiet: the message is filed but nothing reacts to it - no reopen, SLA,
  // unread re-mark, auto-reply or automation. True for a spam message, and
  // for any message threaded onto a conversation in Spam.
  let quiet = message.isSpam
  const threadingCollision =
    thread.matchedBy === 'ambiguous-message-id'
      ? {
          type: 'ambiguous-message-id' as const,
          headerMessageId: message.inReplyTo ?? message.references[0] ?? '',
          occurredAt: new Date().toISOString(),
        }
      : null

  if (!conversationId) {
    conversationId = randomUUID()
    isNewConversation = true
    const displayId = await allocateConversationDisplayId(tx, inbox.projectId)
    const [contactRow] = await tx
      .select({ companyId: contact.companyId })
      .from(contact)
      .where(eq(contact.id, contactId))
      .limit(1)
    // The provider's spam verdict files a new conversation straight into Spam.
    const spamAt = message.isSpam ? new Date() : null
    // Null for a `mail` address or a spam message: no SLA.
    const initialSla = await resolveSlaAssignment(
      {
        projectId: inbox.projectId,
        inboxId: inbox.id,
        priority: null,
        companyId: contactRow?.companyId,
        tagIds: [],
        start: message.receivedAt,
        conversation: { behaviour: input.behaviour, spamAt, deletedAt: null },
      },
      tx
    )

    const conversationMetadata = {
      ...(threadingCollision ? { threadingCollision } : {}),
      ...(input.conversationMetadata ?? {}),
    }

    await tx.insert(conversation).values({
      id: conversationId,
      inboxId: inbox.id,
      projectId: inbox.projectId,
      contactId,
      displayId,
      subject: message.subject,
      status: 'open',
      // The address the mail arrived on and its behaviour at this moment;
      // replies threaded onto the conversation later never change these.
      mailAddressId: input.mailAddressId,
      behaviour: input.behaviour,
      spamAt,
      ...(initialSla ?? {}),
      // Threading matches replies against this.
      channelThreadKey: message.references[0] ?? message.messageId,
      metadata: Object.keys(conversationMetadata).length > 0 ? conversationMetadata : null,
      lastActivityAt: message.receivedAt,
      lastCustomerReplyAt: message.receivedAt,
      createdAt: message.receivedAt,
      updatedAt: new Date(),
    })

    if (threadingCollision) {
      logger.warn('Ambiguous inbound Message-ID created a new conversation', {
        ...logContext,
        inboxId: inbox.id,
        headerMessageId: threadingCollision.headerMessageId,
        conversationId,
      })
    }
  } else {
    // Never overwrite `projectId` on an existing conversation - an agent
    // may have corrected it (stage doc step 7).
    const [existingThread] = await tx
      .select({
        status: conversation.status,
        assigneeUserId: conversation.assigneeUserId,
        contactId: conversation.contactId,
        priority: conversation.priority,
        firstResponseAt: conversation.firstResponseAt,
        slaPolicyId: conversation.slaPolicyId,
        firstResponseDueAt: conversation.firstResponseDueAt,
        nextResponseDueAt: conversation.nextResponseDueAt,
        resolutionDueAt: conversation.resolutionDueAt,
        slaPausedAt: conversation.slaPausedAt,
        slaPausedMinutes: conversation.slaPausedMinutes,
        behaviour: conversation.behaviour,
        spamAt: conversation.spamAt,
        deletedAt: conversation.deletedAt,
      })
      .from(conversation)
      .where(eq(conversation.id, conversationId))
      .for('update')
      .limit(1)

    // A conversation in Spam stays there: the reply is filed quietly.
    quiet ||= existingThread.spamAt !== null

    if (!quiet) {
      const updates: Partial<typeof conversation.$inferInsert> = updatesForInboundReply(
        existingThread,
        message.receivedAt,
        new Date()
      )
      // A reply to a conversation in Trash restores it and is handled as usual.
      if (existingThread.deletedAt) updates.deletedAt = null
      // SLA timers only run for helpdesk conversations (not `mail` addresses).
      const helpdesk = helpdeskAppliesTo({ behaviour: existingThread.behaviour, spamAt: null, deletedAt: null })
      if (helpdesk && existingThread.slaPausedAt) {
        const [policyRow] = existingThread.slaPolicyId
          ? await tx
              .select({ hours: businessHours })
              .from(slaPolicy)
              .leftJoin(businessHours, eq(slaPolicy.businessHoursId, businessHours.id))
              .where(eq(slaPolicy.id, existingThread.slaPolicyId))
              .limit(1)
          : []
        const resumed = resumeSlaDeadlines({
          deadlines: {
            firstResponseDueAt: existingThread.firstResponseDueAt,
            nextResponseDueAt: existingThread.nextResponseDueAt,
            resolutionDueAt: existingThread.resolutionDueAt,
          },
          pausedAt: existingThread.slaPausedAt,
          resumedAt: message.receivedAt,
          businessHours: policyRow?.hours
            ? {
                timezone: policyRow.hours.timezone,
                weeklySchedule: policyRow.hours.weeklySchedule,
                holidays: policyRow.hours.holidays,
              }
            : null,
        })
        updates.firstResponseDueAt = resumed.firstResponseDueAt
        updates.nextResponseDueAt = resumed.nextResponseDueAt
        updates.resolutionDueAt = resumed.resolutionDueAt
        updates.slaPausedAt = null
        updates.slaPausedMinutes = existingThread.slaPausedMinutes + resumed.pausedMinutes
      }
      if (helpdesk && existingThread.firstResponseAt) {
        const [contactRow] = await tx
          .select({ companyId: contact.companyId })
          .from(contact)
          .where(eq(contact.id, existingThread.contactId))
          .limit(1)
        const tags = await tx
          .select({ tagId: conversationTag.tagId })
          .from(conversationTag)
          .where(eq(conversationTag.conversationId, conversationId))
        const nextSla = await resolveSlaAssignment(
          {
            projectId: inbox.projectId,
            inboxId: inbox.id,
            priority: existingThread.priority,
            companyId: contactRow?.companyId,
            tagIds: tags.map((tag) => tag.tagId),
            start: message.receivedAt,
            includeNextResponse: true,
            // The state after this reply: not spam (quiet replies never get here) and out of Trash.
            conversation: { ...existingThread, spamAt: null, deletedAt: null },
          },
          tx
        )
        updates.nextResponseDueAt = nextSla?.nextResponseDueAt ?? null
      }
      const [updatedThread] = await tx
        .update(conversation)
        .set(updates)
        .where(eq(conversation.id, conversationId))
        .returning({ assigneeUserId: conversation.assigneeUserId })
      await reMarkConversationUnreadForIncoming(tx, conversationId, updatedThread.assigneeUserId)

      if (existingThread.status === 'resolved' || existingThread.status === 'pending') {
        await recordConversationActivity(
          tx,
          conversationId,
          [{ field: 'status', from: existingThread.status, to: 'open' }],
          null
        )
        await recordConversationStatusEvent(tx, {
          projectId: inbox.projectId,
          inboxId: inbox.id,
          conversationId,
          fromStatus: existingThread.status,
          toStatus: 'open',
          actorUserId: null,
          occurredAt: message.receivedAt,
        })
      }
    }
  }

  // ---- Message --------------------------------------------------------------
  const messageId = randomUUID()
  await tx.insert(conversationMessage).values({
    id: messageId,
    conversationId,
    kind: 'incoming',
    body: input.body,
    bodyHtml: input.bodyHtml,
    senderKind: 'contact',
    senderContactId: contactId,
    senderUserId: null,
    isPrivate: false,
    // Threading matches replies on this column, so it must carry the RFC
    // Message-ID rather than our own row id.
    channelMessageId: message.messageId,
    inReplyTo: message.inReplyTo,
    channelHeaders: message.rawHeaders,
    // Inbound mail has already been delivered; `pending` is for outbound.
    deliveryStatus: 'delivered',
    metadata: {
      ...(input.threading === 'thread' ? { matchedBy: thread.matchedBy } : {}),
      ...(input.messageMetadata ?? {}),
    },
    createdAt: message.receivedAt,
  })

  if (input.attachments.length > 0) {
    await tx.insert(conversationAttachment).values(
      input.attachments.map((file) => ({
        id: file.id,
        messageId,
        storageKey: file.storageKey,
        fileName: file.fileName,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        isInline: file.isInline,
        contentId: file.contentId,
        createdAt: message.receivedAt,
      }))
    )
  }

  // ---- SUP-03-11: CC participants -------------------------------------------
  // Spam does not turn every Cc'd address into a contact.
  if (!quiet) {
    await resolveCcParticipants(tx, {
      conversationId,
      projectId: inbox.projectId,
      cc: message.cc,
      senderContactId: contactId,
      ownAddresses: input.ownAddresses,
    })
  }

  // ---- SUP-04-8: auto-reply ---------------------------------------------------
  // Guard 1 (never on a detected auto-response) is the caller's: inbound email
  // returns at its `isAutoResponse` check before reaching here. Guards 2 and 3
  // (only a new conversation, never twice) collapse into `isNewConversation`:
  // see `auto-reply.ts`. Guard 4 (`Auto-Submitted`) is set by `buildAutoReply`.
  // Guard 5, the per-contact rate limit, is checked here because it needs the store.
  let autoReplyMessageId: string | null = null
  const autoReply = input.autoReply ?? { enabled: inbox.autoReplyEnabled, template: inbox.autoReplyTemplate }

  if (
    shouldSendAutoReply({
      isNewConversation,
      autoReplyEnabled: autoReply.enabled,
      autoReplyTemplate: autoReply.template,
      // Never for a `mail` address or a spam message.
      behaviour: input.behaviour,
      isSpam: message.isSpam,
    })
  ) {
    // Same sender as an agent reply: the receiving address when it is one of
    // the project's verified addresses, otherwise the inbox address.
    const autoReplySender = await resolveConversationSender(
      { inboxId: inbox.id, inboxEmailAddress: inbox.emailAddress, mailAddressId: input.mailAddressId },
      tx
    )
    if (!autoReplySender) {
      // No agent is present to show a 409 to. Log and still file the message.
      logger.warn('Auto-reply is enabled but the inbox has no sending address', { ...logContext, inboxId: inbox.id })
    } else if (!(await isSenderAllowedOrRecordBlock(inbox.projectId, autoReplySender, 'auto_reply'))) {
      // Project sender policy: this project may not send as the inbox address
      // (domain unverified, suspended or deleted). Skip the auto-reply;
      // the ticket is still created. Never true under the legacy policy.
      logger.warn('Auto-reply skipped: sender address is not authorized for this project', {
        ...logContext,
        inboxId: inbox.id,
        conversationId,
      })
    } else if (message.messageId === null) {
      // Cannot thread a reply with nothing to set In-Reply-To to, and an
      // unthreaded acknowledgment risks becoming its own new "ticket" if
      // the customer replies to it. Rare: providers essentially always
      // supply a Message-ID.
      logger.warn('Auto-reply skipped: inbound message has no Message-ID to thread onto', {
        ...logContext,
        conversationId,
      })
    } else {
      const allowed = await getRateLimitStore().consume(
        `support-auto-reply:${contactId}`,
        AUTO_REPLY_RATE_LIMIT_WINDOW_SECONDS * 1000,
        AUTO_REPLY_RATE_LIMIT_MAX
      )

      if (!allowed) {
        logger.warn('Auto-reply rate limit exceeded for contact', { ...logContext, contactId })
      } else {
        const template = autoReply.template as string
        const domain = emailDomain(autoReplySender) ?? emailDomain(process.env.MAIL_FROM ?? '') ?? 'localhost'
        autoReplyMessageId = randomUUID()

        const built = buildAutoReply({
          inbox: { emailAddress: autoReplySender, fromName: inbox.fromName, signature: inbox.signature },
          // The literal sender of this message, not necessarily the
          // contact record's current email - correct even after a merge.
          contact: { email: message.from.address, name: message.from.name ?? null },
          subject: autoReply.subject ?? message.subject ?? '(no subject)',
          template,
          quoteHistory: autoReply.quote ?? true,
          previous: {
            channelMessageId: message.messageId,
            references: message.references,
            fromName: message.from.name ?? message.from.address,
            sentAt: message.receivedAt,
            body: input.body,
            bodyHtml: input.bodyHtml,
          },
          newMessageId: autoReplyMessageId,
          domain,
        })

        const [autoReplyRow] = await tx
          .insert(conversationMessage)
          .values({
            id: autoReplyMessageId,
            conversationId,
            kind: 'outgoing',
            body: template,
            bodyHtml: null,
            senderKind: 'system',
            senderContactId: null,
            senderUserId: null,
            isPrivate: false,
            channelMessageId: built.channelMessageId,
            inReplyTo: built.inReplyTo,
            channelHeaders: built.referencesForStorage ? { references: built.referencesForStorage } : null,
            deliveryStatus: 'pending',
            // Not a substantive agent response - deliberately does not
            // touch firstResponseAt/lastAgentReplyAt.
            metadata: { isAutoReply: true },
            createdAt: new Date(),
          })
          .returning()

        await tx.update(conversation).set({ lastActivityAt: new Date() }).where(eq(conversation.id, conversationId))

        await enqueueOutboundDelivery(tx, { messageId: autoReplyRow.id, payload: built.deliveryPayload })
      }
    }
  }

  return { conversationId, messageId, contactId, isNewConversation, autoReplyMessageId, quiet }
}

/**
 * After the transaction commits: tell agents' screens, run automation and
 * kick the outbox for an auto-reply. Never call this for a rolled-back result.
 */
export async function announceInboundMessage(
  inbox: Pick<IntakeInbox, 'id' | 'projectId'>,
  result: InboundIntakeResult
): Promise<void> {
  await publishConversationEvent({
    type: result.isNewConversation ? 'conversation.created' : 'message.created',
    projectId: inbox.projectId,
    inboxId: inbox.id,
    conversationId: result.conversationId,
    messageId: result.messageId,
  })
  // Spam (and anything filed into Spam) runs no automation. The engine also
  // skips `mail` conversations and conversations in Spam or Trash itself.
  if (!result.quiet) {
    await triggerAutomationEvent({
      conversationId: result.conversationId,
      trigger: result.isNewConversation ? 'conversation_created' : 'message_created',
    })
  }

  if (result.autoReplyMessageId) {
    // A second, real message exists now (the auto-reply) - agents watching
    // the inbox should see it appear without a manual refresh.
    await publishConversationEvent({
      type: 'message.created',
      projectId: inbox.projectId,
      inboxId: inbox.id,
      conversationId: result.conversationId,
      messageId: result.autoReplyMessageId,
    })

    // Fire-and-forget: the outbox row is the durable copy, this is just an
    // optimistic trigger to send it promptly.
    runOutboundDeliveryWorker().catch((error) => {
      logger.error('Auto-reply outbound delivery worker pass failed', {
        error: error instanceof Error ? error.message : error,
      })
    })
  }
}
