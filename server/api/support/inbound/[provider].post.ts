/**
 * @openapi
 * /api/support/inbound/{provider}:
 *   post:
 *     tags: [Support]
 *     summary: Inbound email webhook
 *     description: >
 *       Provider-agnostic intake. Returns 200 for everything it has
 *       deliberately decided not to act on - duplicate deliveries, unknown
 *       recipients, teams with support disabled - because a 4xx makes a mail
 *       provider retry the same message indefinitely. Processing failures
 *       return 500 so the provider retries a recorded, reclaimable event.
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
import { createError, getHeaders, getRouterParam, readRawBody, setResponseStatus } from 'h3'
import { eq } from 'drizzle-orm'
import { createLogger } from '~/server/utils/logger'
import { createSuccessResponse } from '~/server/utils/response'
import { emailDomain, getChannelDriver, type InboundMessage } from '~/server/services/support-channels'
import { resolveInboxByAddress } from '~/server/utils/support-access'
import { allocateConversationDisplayId } from '~/server/utils/support-counter'
import { publishConversationEvent } from '~/server/utils/support-realtime'
import { resolveThread } from '~/server/utils/inbound-threading'
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
  recordInboundRawKey,
  rejectInboundEvent,
} from '~/server/utils/inbound-events'
import { checkRateLimit } from '~/server/utils/rate-limit'
import { resolveInboundProjectId } from '~/server/utils/inbound-routing'
import { getRateLimitStore } from '~/server/services/rate-limit'
import { getStorageProvider } from '~/server/utils/storage'
import {
  AUTO_REPLY_RATE_LIMIT_MAX,
  AUTO_REPLY_RATE_LIMIT_WINDOW_SECONDS,
  buildAutoReply,
  shouldSendAutoReply,
} from '~/server/utils/auto-reply'
import { enqueueOutboundDelivery, runOutboundDeliveryWorker } from '~/server/utils/outbound-delivery'
import { db } from '~/server/database/drizzle'
import {
  conversation,
  conversationAttachment,
  conversationMessage,
  supportInboxAddress,
} from '~/server/database/schema/support'
// Module toggles live in their own schema file, not the support one (delta D-31).
import { teamModuleSettings } from '~/server/database/schema/teams'

const logger = createLogger('support-inbound')

/** Inbound is webhook traffic, not user traffic - a busy inbox is legitimate. */
const INBOUND_RATE_LIMIT = { maxRequests: 120, windowSeconds: 60, identifier: 'support-inbound' }

/** Cheap edge guard against unbounded invalid or cross-tenant provider traffic. */
const INBOUND_EDGE_RATE_LIMIT = { maxRequests: 5_000, windowSeconds: 60, identifier: 'support-inbound-edge' }

/** Accepted, deliberately did nothing. The provider must not retry. */
function accepted(reason: string) {
  return createSuccessResponse({ accepted: true, reason })
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

  const rawBody = (await readRawBody(event, 'utf8')) ?? ''
  const headers = getHeaders(event) as Record<string, string>

  // ---- 1. Signature -------------------------------------------------------
  // Before anything is read or written. Everything below this line trusts that
  // the payload came from the provider.
  if (!driver.verifySignature({ rawBody, headers, authorization: headers.authorization })) {
    logger.warn('Rejected inbound delivery with an invalid signature', { provider: driver.name })
    throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
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
    const rawStorageKey = `support/inbound/${driver.name}/${new Date().toISOString().slice(0, 10)}/${eventId}.json`
    try {
      await getStorageProvider().putObject({
        key: rawStorageKey,
        buffer: Buffer.from(rawBody, 'utf8'),
        contentType: 'application/json',
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

    // ---- 5. Resolve the inbox from To/Cc ---------------------------------
    // Every recipient is tried, because the support address is frequently in
    // Cc rather than To on a reply-all.
    const recipients = [...message.to, ...message.cc]
    let matched: Awaited<ReturnType<typeof resolveInboxByAddress>> = null
    for (const recipient of recipients) {
      matched = await resolveInboxByAddress(recipient.address)
      if (matched) break
    }

    if (!matched) {
      // Recorded, not 404'd: a 404 makes the provider retry forever, and the
      // record is how a misconfigured address becomes visible.
      if (!(await rejectInboundEvent(claimToken, `No inbox matches any recipient of ${providerEventId}`))) {
        throw new Error('Inbound claim lost before rejection')
      }
      return accepted('no-matching-inbox')
    }

    const { inbox, address } = matched
    if (!(await attachInboundEventInbox(claimToken, inbox.id))) {
      throw new Error('Inbound claim lost before inbox attachment')
    }

    if (!(await checkRateLimit(event, { ...INBOUND_RATE_LIMIT, subject: inbox.id }))) {
      // A provider IP carries traffic for many tenants, so only this inbox's
      // bucket is exhausted. The catch below records the failed attempt and
      // preserves the 429 so the provider backs off.
      throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
    }

    // ---- SUP-03-10: honour the team's Support module toggle ---------------
    const [modules] = await db
      .select({ supportEnabled: teamModuleSettings.supportEnabled })
      .from(teamModuleSettings)
      .where(eq(teamModuleSettings.teamId, inbox.teamId))
      .limit(1)

    // Absent row means defaults, and `supportEnabled` defaults to false
    // (delta D-31). Treating "no row" as enabled would let inbound mail create
    // tickets for a team that never switched Support on.
    if (!modules?.supportEnabled) {
      if (!(await rejectInboundEvent(claimToken, 'Support is disabled for this team'))) {
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

    const stripped = stripQuotedReply({ text: message.text, html: message.html })

    // The inbox's own addresses, so a support address in Cc never becomes a
    // contact or a participant on its own thread.
    const ownAddressRows = await db
      .select({ address: supportInboxAddress.address })
      .from(supportInboxAddress)
      .where(eq(supportInboxAddress.inboxId, inbox.id))
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
      // ---- 6. Contact ----------------------------------------------------
      const { contactId } = await resolveOrCreateContact(tx, inbox.teamId, message.from)

      // ---- 7. Conversation -----------------------------------------------
      const thread = await resolveThread(tx, { id: inbox.id, teamId: inbox.teamId }, message, contactId)

      let conversationId = thread.conversationId
      let isNewConversation = false
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
        const displayId = await allocateConversationDisplayId(tx, inbox.teamId)

        await tx.insert(conversation).values({
          id: conversationId,
          inboxId: inbox.id,
          teamId: inbox.teamId,
          contactId,
          // ---- SUP-03-12: product attribution from the matched address ----
          // Null when the address is unmapped, per delta D-27.
          projectId: resolveInboundProjectId({
            addressProjectId: address.projectId,
            inboxProjectId: inbox.projectId,
          }),
          displayId,
          subject: message.subject,
          status: 'open',
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
        await tx
          .update(conversation)
          .set({
            lastActivityAt: message.receivedAt,
            lastCustomerReplyAt: message.receivedAt,
            updatedAt: new Date(),
          })
          .where(eq(conversation.id, conversationId))
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
        metadata: { rawBody: stripped.rawBody, matchedBy: thread.matchedBy },
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
      await resolveCcParticipants(tx, {
        conversationId,
        teamId: inbox.teamId,
        cc: message.cc,
        senderContactId: contactId,
        ownAddresses,
      })

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
        })
      ) {
        if (!inbox.emailAddress) {
          // No agent is present to show a 409 to - this is a webhook. Log and
          // still ticket the customer's message normally.
          logger.warn('Auto-reply is enabled but the inbox has no sending address', { inboxId: inbox.id })
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
            const domain = emailDomain(inbox.emailAddress) ?? emailDomain(process.env.MAIL_FROM ?? '') ?? 'localhost'
            autoReplyMessageId = randomUUID()

            const autoReply = buildAutoReply({
              inbox: { emailAddress: inbox.emailAddress, fromName: inbox.fromName, signature: inbox.signature },
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
                // flagged in parallel-agents.md for whoever builds SLA to
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

      return { conversationId, messageId, isNewConversation, autoReplyMessageId }
    })

    await publishConversationEvent({
      type: result.isNewConversation ? 'conversation.created' : 'message.created',
      teamId: inbox.teamId,
      inboxId: inbox.id,
      conversationId: result.conversationId,
      messageId: result.messageId,
    })

    if (result.autoReplyMessageId) {
      // A second, real message exists now (the auto-reply) - agents watching
      // the inbox should see it appear without a manual refresh, same as any
      // other new message.
      await publishConversationEvent({
        type: 'message.created',
        teamId: inbox.teamId,
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
