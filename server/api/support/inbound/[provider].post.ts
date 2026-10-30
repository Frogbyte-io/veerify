/**
 * @openapi
 * /api/support/inbound/{provider}:
 *   post:
 *     tags: [Support]
 *     summary: Inbound email webhook
 *     description: >
 *       Provider-agnostic intake. Returns 200 for everything it has
 *       deliberately decided not to act on - duplicate deliveries, unknown
 *       recipients, projects with support disabled - because a 4xx makes a mail
 *       provider retry the same message indefinitely. Processing failures
 *       return 500 so the provider retries a recorded, reclaimable event.
 *       The inbox is found by the recipients' exact addresses first, then by a
 *       catch-all (`*@domain`) of a recipient's exact domain. A new conversation
 *       records the matched address and its behaviour (`mail` conversations get
 *       no auto-reply, SLA, CSAT or automation). A message the provider flags
 *       as spam (Mailgun/Frogmail `X-Mailgun-Sflag: Yes` or `frogmail-verdicts`
 *       spam/virus FAIL; Postmark `X-Spam-Status: Yes`) opens its conversation
 *       in Spam, or is appended to an existing one without reopening it, and
 *       triggers no auto-reply or automation. A reply to a conversation in
 *       Spam stays in Spam the same way; a reply to one in Trash restores it.
 *     operationId: receiveSupportInboundEmail
 *     security: []
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string, enum: [postmark, mailgun] }
 *     responses:
 *       200: { description: Accepted, or deliberately ignored }
 *       401: { description: Signature or credential verification failed }
 *       404: { description: Unknown provider }
 *       429: { description: Rate limited }
 *       500: { description: Recorded processing failure; retry requested }
 */
import { randomUUID } from 'node:crypto'
import { createError, getHeaders, getRouterParam, readMultipartFormData, readRawBody, setResponseStatus } from 'h3'
import { eq } from 'drizzle-orm'
import { createLogger } from '~/server/utils/logger'
import { createSuccessResponse } from '~/server/utils/response'
import { emailDomain, getChannelDriver, type InboundMessage } from '~/server/services/support-channels'
import { resolveInboxForRecipients } from '~/server/utils/support-access'
import { helpdeskAppliesTo } from '~/server/utils/conversation-behaviour'
import { DEFAULT_MAIL_ADDRESS_BEHAVIOUR, isMailAddressBehaviour, type MailAddressBehaviour } from '~/lib/mail-address'
import { allocateConversationDisplayId } from '~/server/utils/support-counter'
import { publishConversationEvent } from '~/server/utils/support-realtime'
import { resolveThread, updatesForInboundReply } from '~/server/utils/inbound-threading'
import { recordConversationActivity, recordConversationStatusEvent } from '~/server/utils/conversation-activity'
import { stripQuotedReply } from '~/server/utils/inbound-content'
import { sanitizeInboundHtml } from '~/server/utils/inbound-sanitize'
import { isAutoResponse } from '~/server/utils/inbound-autoresponse'
import { resolveCcParticipants, resolveOrCreateContact } from '~/server/utils/inbound-contacts'
import { ingestInboundAttachments, rewriteInlineCidReferences } from '~/server/utils/inbound-attachments'
import {
  attachInboundEventInbox,
  claimInboundEvent,
  completeInboundEvent,
  failInboundEvent,
  findInboxIncomingMessage,
  lockInboxMessageId,
  recordInboundRawKey,
  rejectInboundEvent,
} from '~/server/utils/inbound-events'
import { checkRateLimit } from '~/server/utils/rate-limit'
import { inboundRoutingRecipients } from '~/server/utils/inbound-routing'
import { getRateLimitStore } from '~/server/services/rate-limit'
import { getStorageProvider } from '~/server/utils/storage'
import {
  AUTO_REPLY_RATE_LIMIT_MAX,
  AUTO_REPLY_RATE_LIMIT_WINDOW_SECONDS,
  buildAutoReply,
  shouldSendAutoReply,
} from '~/server/utils/auto-reply'
import { enqueueOutboundDelivery, runOutboundDeliveryWorker } from '~/server/utils/outbound-delivery'
import { isSenderAllowedOrRecordBlock } from '~/server/utils/sender-enforcement'
import { reMarkConversationUnreadForIncoming } from '~/server/utils/conversation-read-state'
import { db } from '~/server/database/drizzle'
import {
  businessHours,
  contact,
  conversation,
  conversationAttachment,
  conversationMessage,
  conversationTag,
  slaPolicy,
  projectMailAddress,
} from '~/server/database/schema/support'
import { resolveSlaAssignment } from '~/server/utils/sla-assignment'
import { resolveConversationSender } from '~/server/utils/conversation-sender'
import { resumeSlaDeadlines } from '~/server/utils/sla-timers'
import { triggerAutomationEvent } from '~/server/utils/automation-engine'
import { getProjectById } from '~/server/utils/project-access'
import { isModuleEnabled } from '~/lib/modules'

const logger = createLogger('support-inbound')

/** Inbound is webhook traffic, not user traffic - a busy inbox is legitimate. */
const INBOUND_RATE_LIMIT = { maxRequests: 120, windowSeconds: 60, identifier: 'support-inbound' }

/** Cheap edge guard against unbounded invalid or cross-tenant provider traffic. */
const INBOUND_EDGE_RATE_LIMIT = { maxRequests: 5_000, windowSeconds: 60, identifier: 'support-inbound-edge' }

/** Accepted, deliberately did nothing. The provider must not retry. */
function accepted(reason: string) {
  return createSuccessResponse({ accepted: true, reason })
}

function mailgunPayloadFromMultipart(parts: Awaited<ReturnType<typeof readMultipartFormData>>) {
  const payload: Record<string, unknown> = {}
  for (const part of parts ?? []) {
    if (!part.name) continue

    if (part.filename) {
      payload[part.name] = { filename: part.filename, type: part.type, data: part.data }
      continue
    }

    const value = part.data.toString('utf8')
    if (part.name === 'body-html' && payload[part.name] !== undefined) {
      const prior = payload[part.name]
      payload[part.name] = Array.isArray(prior) ? [...prior, value] : [prior, value]
    } else {
      payload[part.name] = value
    }
  }
  return payload
}

function mailgunPayloadFromUrlEncoded(rawBody: string) {
  const payload: Record<string, string> = {}
  for (const [name, value] of new URLSearchParams(rawBody)) payload[name] = value
  return payload
}

export default defineEventHandler(async (event) => {
  const providerName = getRouterParam(event, 'provider') as string

  // Unknown provider names resolve to null rather than a default driver, so a
  // typo in the webhook URL cannot be verified under the wrong scheme.
  const driver = getChannelDriver(providerName)
  if (!driver) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown inbound provider' })
  }

  if (!(await checkRateLimit(event, INBOUND_EDGE_RATE_LIMIT))) {
    throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
  }

  const headers = getHeaders(event) as Record<string, string>
  const rawBodyBuffer = (await readRawBody(event, false)) ?? Buffer.alloc(0)
  // H3's multipart reader calls readRawBody again. Cache the first read on the
  // event so adapters that supplied a one-shot request stream remain readable.
  event._requestBody = rawBodyBuffer
  const rawBody = rawBodyBuffer.toString('utf8')
  const contentType = String(headers['content-type'] ?? '').toLowerCase()
  let mailgunPayload: Record<string, unknown> | undefined

  if (driver.name === 'mailgun') {
    if (contentType.startsWith('multipart/form-data')) {
      mailgunPayload = mailgunPayloadFromMultipart(await readMultipartFormData(event))
    } else if (contentType.startsWith('application/x-www-form-urlencoded')) {
      mailgunPayload = mailgunPayloadFromUrlEncoded(rawBody)
    }
  }

  // ---- 1. Signature -------------------------------------------------------
  // Before anything is read or written. Everything below this line trusts that
  // the payload came from the provider.
  if (
    !driver.verifySignature({
      rawBody,
      headers,
      authorization: headers.authorization,
      ...(mailgunPayload ? { payload: mailgunPayload } : {}),
    })
  ) {
    logger.warn('Rejected inbound delivery with an invalid signature', { provider: driver.name })
    throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })
  }

  let payload: unknown
  try {
    payload = mailgunPayload ?? JSON.parse(rawBody)
  } catch {
    // Signature-valid but unreadable. No event id can be extracted, so there
    // is nothing to key an event row on; 200 so it is not retried forever.
    logger.error('Inbound payload was signature-valid but not JSON', { provider: driver.name })
    return accepted('unparseable-payload')
  }

  const providerEventId = driver.extractEventId(payload)
  if (!providerEventId) {
    logger.error('Inbound payload carried no usable event id', { provider: driver.name })
    return accepted('missing-event-id')
  }

  // ---- 2. Atomic claim ----------------------------------------------------
  // Ahead of parsing on purpose: a crash later leaves a claimed row whose
  // lease lapses and is retried, rather than an email nothing remembers.
  const claim = await claimInboundEvent({ provider: driver.name, providerEventId })

  if (claim.outcome === 'duplicate') {
    return accepted('duplicate-delivery')
  }
  if (claim.outcome === 'in-progress') {
    return accepted('already-processing')
  }

  const { eventId, attemptCount } = claim
  const claimToken = { eventId, attemptCount }

  try {
    // ---- 3. Archive raw, before parsing ----------------------------------
    // So a parse failure is debuggable and replayable rather than lost.
    const rawExtension = contentType.startsWith('multipart/form-data')
      ? 'multipart'
      : contentType.startsWith('application/x-www-form-urlencoded')
        ? 'form'
        : 'json'
    const rawStorageKey = `support/inbound/${driver.name}/${new Date().toISOString().slice(0, 10)}/${eventId}.${rawExtension}`
    try {
      await getStorageProvider().putObject({
        key: rawStorageKey,
        buffer: rawBodyBuffer,
        contentType: headers['content-type'] || 'application/json',
      })
      await recordInboundRawKey(claimToken, rawStorageKey)
    } catch (storageError) {
      // Archiving is for debuggability; losing it must not lose the email.
      logger.error('Failed to archive raw inbound payload', {
        eventId,
        error: storageError instanceof Error ? storageError.message : storageError,
      })
    }

    // ---- 4. Parse --------------------------------------------------------
    const message: InboundMessage = driver.parse(payload)

    // ---- 5. Resolve the inbox from the envelope, else To/Cc --------------
    // The envelope recipient the provider delivered to wins (Bcc, forwarding,
    // aliases); To/Cc are only consulted when the provider reported none.
    // Exact addresses for every recipient win over any catch-all (`*@domain`);
    // a catch-all only covers its own exact domain.
    const recipients = inboundRoutingRecipients(message)
    const matched = await resolveInboxForRecipients(recipients.map((recipient) => recipient.address))

    if (!matched) {
      // Recorded, not 404'd: a 404 makes the provider retry forever, and the
      // record is how a misconfigured address becomes visible.
      if (!(await rejectInboundEvent(claimToken, `No inbox matches any recipient of ${providerEventId}`))) {
        throw new Error('Inbound claim lost before rejection')
      }
      return accepted('no-matching-inbox')
    }

    const { inbox, address: matchedAddress } = matched
    // Snapshotted onto a conversation this message opens.
    const addressBehaviour: MailAddressBehaviour = isMailAddressBehaviour(matchedAddress.behaviour)
      ? matchedAddress.behaviour
      : DEFAULT_MAIL_ADDRESS_BEHAVIOUR

    if (!(await attachInboundEventInbox(claimToken, inbox.id))) {
      throw new Error('Inbound claim lost before inbox attachment')
    }

    if (!(await checkRateLimit(event, { ...INBOUND_RATE_LIMIT, subject: inbox.id }))) {
      // A provider IP carries traffic for many tenants, so only this inbox's
      // bucket is exhausted. The catch below records the failed attempt and
      // preserves the 429 so the provider backs off.
      throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
    }

    // ---- SUP-03-10: honour the project's Support module toggle ---------------
    // Absent project or an unset switch means Support is off (module defaults).
    // Treating that as enabled would let inbound mail create tickets for a
    // project that never switched Support on.
    const owningProject = await getProjectById(inbox.projectId)
    if (!owningProject || !isModuleEnabled(owningProject.settings, 'supportEnabled')) {
      if (!(await rejectInboundEvent(claimToken, 'Support is disabled for this project'))) {
        throw new Error('Inbound claim lost before rejection')
      }
      return accepted('support-disabled')
    }

    if (!inbox.isEnabled) {
      if (!(await rejectInboundEvent(claimToken, 'Inbox is disabled'))) {
        throw new Error('Inbound claim lost before rejection')
      }
      return accepted('inbox-disabled')
    }

    // Auto-responses are recorded and dropped: replying to a vacation
    // responder is how mail loops start.
    if (isAutoResponse(message.rawHeaders)) {
      if (!(await rejectInboundEvent(claimToken, 'Auto-response detected'))) {
        throw new Error('Inbound claim lost before rejection')
      }
      return accepted('auto-response')
    }

    // ---- Per-inbox duplicate --------------------------------------------
    // The same email delivered again to this inbox under a different event
    // key (another alias of the inbox, or a retry across a key change). Checked
    // here without a lock so the common case writes no attachments; the
    // locked re-check inside the transaction below is the authoritative one.
    if (message.messageId) {
      const alreadyFiled = await findInboxIncomingMessage(db, inbox.id, message.messageId)
      if (alreadyFiled) {
        if (!(await completeInboundEvent(claimToken, alreadyFiled.conversationId))) {
          throw new Error('Inbound claim lost before duplicate completion')
        }
        return accepted('duplicate-in-inbox')
      }
    }

    const stripped = stripQuotedReply({ text: message.text, html: message.html })

    // The inbox's own addresses, so a support address in Cc never becomes a
    // contact or a participant on its own thread.
    const ownAddressRows = await db
      .select({ address: projectMailAddress.address })
      .from(projectMailAddress)
      .where(eq(projectMailAddress.inboxId, inbox.id))
    const ownAddresses = new Set(ownAddressRows.map((row) => row.address.toLowerCase()))

    // ---- SUP-03-8: attachments -------------------------------------------
    // Ahead of the transaction, because storage writes cannot roll back and
    // the inline rewrite needs attachment ids before any row exists. A rolled
    // back transaction therefore leaves orphaned objects rather than orphaned
    // rows, which is the right way round: unreferenced bytes are collectable,
    // a row pointing at nothing is not.
    const attachments = await ingestInboundAttachments({
      attachments: message.attachments,
      eventId,
      provider: driver.name,
    })

    // Rewrite `cid:` to our own attachment route BEFORE sanitizing, so the
    // sanitizer judges an ordinary same-origin path by its normal rules
    // instead of being taught about `cid:`.
    const safeHtml = sanitizeInboundHtml(rewriteInlineCidReferences(message.html, attachments.inlineByContentId))

    const result = await db.transaction(async (tx) => {
      if (message.messageId) {
        await lockInboxMessageId(tx, inbox.id, message.messageId)
        const alreadyFiled = await findInboxIncomingMessage(tx, inbox.id, message.messageId)
        if (alreadyFiled) {
          if (!(await completeInboundEvent(claimToken, alreadyFiled.conversationId, tx))) {
            throw new Error('Inbound claim lost before duplicate completion')
          }
          return { duplicateOfConversationId: alreadyFiled.conversationId }
        }
      }

      // ---- 6. Contact ----------------------------------------------------
      const { contactId } = await resolveOrCreateContact(tx, inbox.projectId, message.from)

      // ---- 7. Conversation -----------------------------------------------
      const thread = await resolveThread(tx, { id: inbox.id, projectId: inbox.projectId }, message, contactId)

      let conversationId = thread.conversationId
      let isNewConversation = false
      // Quiet: the message is filed but nothing reacts to it - no reopen, SLA,
      // unread re-mark, auto-reply or automation. True for a spam message, and
      // for any message threaded onto a conversation in Spam.
      let quiet = message.isSpam
      let initialSla: Awaited<ReturnType<typeof resolveSlaAssignment>> = null
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
        initialSla = await resolveSlaAssignment(
          {
            projectId: inbox.projectId,
            inboxId: inbox.id,
            priority: null,
            companyId: contactRow?.companyId,
            tagIds: [],
            start: message.receivedAt,
            conversation: { behaviour: addressBehaviour, spamAt, deletedAt: null },
          },
          tx
        )

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
          mailAddressId: matchedAddress.id,
          behaviour: addressBehaviour,
          spamAt,
          ...(initialSla ?? {}),
          // Agent 2's threading matches replies against this. Writing it is
          // what makes their `thread-key` branch reachable at all.
          channelThreadKey: message.references[0] ?? message.messageId,
          metadata: threadingCollision ? { threadingCollision } : null,
          lastActivityAt: message.receivedAt,
          lastCustomerReplyAt: message.receivedAt,
          createdAt: message.receivedAt,
          updatedAt: new Date(),
        })

        if (threadingCollision) {
          logger.warn('Ambiguous inbound Message-ID created a new conversation', {
            provider: driver.name,
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

      // ---- 8. Message ------------------------------------------------------
      const messageId = randomUUID()
      await tx.insert(conversationMessage).values({
        id: messageId,
        conversationId,
        kind: 'incoming',
        body: stripped.body,
        bodyHtml: safeHtml,
        senderKind: 'contact',
        senderContactId: contactId,
        senderUserId: null,
        isPrivate: false,
        // Agent 2's threading matches replies on this column, so it must carry
        // the RFC Message-ID rather than our own row id.
        channelMessageId: message.messageId,
        inReplyTo: message.inReplyTo,
        channelHeaders: message.rawHeaders,
        // Inbound mail has already been delivered; `pending` is for outbound.
        deliveryStatus: 'delivered',
        metadata: {
          rawBody: stripped.rawBody,
          matchedBy: thread.matchedBy,
          ...(message.isSpam ? { spam: true } : {}),
          ...(message.frogmailForwards?.length ? { frogmailForwards: message.frogmailForwards } : {}),
          ...(message.attachmentsRemoved ? { attachmentsRemoved: true } : {}),
        },
        createdAt: message.receivedAt,
      })

      if (attachments.stored.length > 0) {
        await tx.insert(conversationAttachment).values(
          attachments.stored.map((file) => ({
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

      // ---- SUP-03-11: CC participants -------------------------------------
      // Spam does not turn every Cc'd address into a contact.
      if (!quiet) {
        await resolveCcParticipants(tx, {
          conversationId,
          projectId: inbox.projectId,
          cc: message.cc,
          senderContactId: contactId,
          ownAddresses,
        })
      }

      // ---- SUP-04-8: auto-reply --------------------------------------------
      // Guard 1 (never on a detected auto-response) is enforced above this
      // transaction - a flagged message returns at the `isAutoResponse` check
      // and never reaches here. Guards 2 and 3 (only a new conversation, never
      // twice) collapse into `isNewConversation`: see `auto-reply.ts`. Guard 4
      // (`Auto-Submitted`) is set by `buildAutoReply`. Guard 5, the per-contact
      // rate limit, is checked here because it needs the store.
      let autoReplyMessageId: string | null = null

      if (
        shouldSendAutoReply({
          isNewConversation,
          autoReplyEnabled: inbox.autoReplyEnabled,
          autoReplyTemplate: inbox.autoReplyTemplate,
          // Never for a `mail` address or a spam message.
          behaviour: addressBehaviour,
          isSpam: message.isSpam,
        })
      ) {
        // Same sender as an agent reply: the receiving address when it is one of
        // the project's verified addresses, otherwise the inbox address.
        const autoReplySender = await resolveConversationSender(
          { inboxId: inbox.id, inboxEmailAddress: inbox.emailAddress, mailAddressId: matchedAddress.id },
          tx
        )
        if (!autoReplySender) {
          // No agent is present to show a 409 to - this is a webhook. Log and
          // still ticket the customer's message normally.
          logger.warn('Auto-reply is enabled but the inbox has no sending address', { inboxId: inbox.id })
        } else if (!(await isSenderAllowedOrRecordBlock(inbox.projectId, autoReplySender, 'auto_reply'))) {
          // Project sender policy: this project may not send as the inbox address
          // (domain unverified, suspended or deleted). Skip the auto-reply;
          // the ticket is still created. Never true under the legacy policy.
          logger.warn('Auto-reply skipped: sender address is not authorized for this project', {
            inboxId: inbox.id,
            conversationId,
          })
        } else if (message.messageId === null) {
          // Cannot thread a reply with nothing to set In-Reply-To to, and an
          // unthreaded acknowledgment risks becoming its own new "ticket" if
          // the customer replies to it. Rare: providers essentially always
          // supply a Message-ID.
          logger.warn('Auto-reply skipped: inbound message has no Message-ID to thread onto', { conversationId })
        } else {
          const allowed = await getRateLimitStore().consume(
            `support-auto-reply:${contactId}`,
            AUTO_REPLY_RATE_LIMIT_WINDOW_SECONDS * 1000,
            AUTO_REPLY_RATE_LIMIT_MAX
          )

          if (!allowed) {
            logger.warn('Auto-reply rate limit exceeded for contact', { contactId })
          } else {
            const domain = emailDomain(autoReplySender) ?? emailDomain(process.env.MAIL_FROM ?? '') ?? 'localhost'
            autoReplyMessageId = randomUUID()

            const autoReply = buildAutoReply({
              inbox: { emailAddress: autoReplySender, fromName: inbox.fromName, signature: inbox.signature },
              // The literal sender of this email, not necessarily the
              // contact record's current email - correct even after a merge.
              contact: { email: message.from.address, name: message.from.name ?? null },
              subject: message.subject ?? '(no subject)',
              template: inbox.autoReplyTemplate as string,
              previous: {
                channelMessageId: message.messageId,
                references: message.references,
                fromName: message.from.name ?? message.from.address,
                sentAt: message.receivedAt,
                body: stripped.body,
                bodyHtml: safeHtml,
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
                body: inbox.autoReplyTemplate as string,
                bodyHtml: null,
                senderKind: 'system',
                senderContactId: null,
                senderUserId: null,
                isPrivate: false,
                channelMessageId: autoReply.channelMessageId,
                inReplyTo: autoReply.inReplyTo,
                channelHeaders: autoReply.referencesForStorage ? { references: autoReply.referencesForStorage } : null,
                deliveryStatus: 'pending',
                // Not a substantive agent response - deliberately does not
                // touch firstResponseAt/lastAgentReplyAt (Stage 06 territory;
                // flagged for the SLA implementation to
                // confirm this reading rather than assume it).
                metadata: { isAutoReply: true },
                createdAt: new Date(),
              })
              .returning()

            await tx.update(conversation).set({ lastActivityAt: new Date() }).where(eq(conversation.id, conversationId))

            await enqueueOutboundDelivery(tx, { messageId: autoReplyRow.id, payload: autoReply.deliveryPayload })
          }
        }
      }

      const completed = await completeInboundEvent(claimToken, conversationId, tx)
      if (!completed) {
        throw new Error('Inbound claim lost before terminal completion')
      }

      return { conversationId, messageId, isNewConversation, autoReplyMessageId, quiet }
    })

    if ('duplicateOfConversationId' in result) {
      // Lost the race to a concurrent delivery of the same email to this
      // inbox. The attachments stored above belong to no row; remove them,
      // best effort - a leftover object is harmless, only unreferenced.
      for (const file of attachments.stored) {
        await getStorageProvider()
          .deleteObject(file.storageKey)
          .catch((error: unknown) => {
            logger.warn('Failed to delete an attachment of a duplicate inbound delivery', {
              eventId,
              error: error instanceof Error ? error.message : error,
            })
          })
      }
      return accepted('duplicate-in-inbox')
    }

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
      // the inbox should see it appear without a manual refresh, same as any
      // other new message.
      await publishConversationEvent({
        type: 'message.created',
        projectId: inbox.projectId,
        inboxId: inbox.id,
        conversationId: result.conversationId,
        messageId: result.autoReplyMessageId,
      })

      // Fire-and-forget, same reasoning as SUP-04-4: the outbox row is the
      // durable copy, this is just an optimistic trigger to send it promptly.
      runOutboundDeliveryWorker().catch((error) => {
        logger.error('Auto-reply outbound delivery worker pass failed', {
          error: error instanceof Error ? error.message : error,
        })
      })
    }

    setResponseStatus(event, 200)
    return createSuccessResponse({
      accepted: true,
      conversationId: result.conversationId,
      created: result.isNewConversation,
    })
  } catch (error) {
    // Failed and replayable: the lease is cleared so the provider's next retry
    // reclaims it immediately. A non-2xx is essential here; acknowledging a
    // failed event would leave no scheduler or provider retry to replay it.
    await failInboundEvent(claimToken, error)
    logger.error('Inbound processing failed', {
      eventId,
      provider: driver.name,
      error: error instanceof Error ? error.message : error,
    })
    if (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 429) {
      throw error
    }
    throw createError({ statusCode: 500, statusMessage: 'Inbound processing failed' })
  }
})
