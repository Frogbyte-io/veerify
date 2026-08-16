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
 *       provider retry the same message indefinitely. Only a failed signature
 *       is a 401.
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
 */
import { randomUUID } from 'node:crypto'
import { createError, getHeaders, getRouterParam, readRawBody, setResponseStatus } from 'h3'
import { and, eq, inArray } from 'drizzle-orm'
import { createLogger } from '~/server/utils/logger'
import { createSuccessResponse } from '~/server/utils/response'
import { getChannelDriver, type InboundMessage } from '~/server/services/support-channels'
import { resolveInboxByAddress } from '~/server/utils/support-access'
import { allocateConversationDisplayId } from '~/server/utils/support-counter'
import { publishConversationEvent } from '~/server/utils/support-realtime'
import { resolveThread } from '~/server/utils/inbound-threading'
import { stripQuotedReply } from '~/server/utils/inbound-content'
import { sanitizeInboundHtml } from '~/server/utils/inbound-sanitize'
import { isAutoResponse } from '~/server/utils/inbound-autoresponse'
import { resolveCcParticipants, resolveOrCreateContact } from '~/server/utils/inbound-contacts'
import {
  attachInboundEventInbox,
  claimInboundEvent,
  completeInboundEvent,
  failInboundEvent,
  recordInboundRawKey,
  rejectInboundEvent,
} from '~/server/utils/inbound-events'
import { checkRateLimit } from '~/server/utils/rate-limit'
import { getStorageProvider } from '~/server/utils/storage'
import { db } from '~/server/database/drizzle'
import { conversation, conversationMessage, supportInboxAddress } from '~/server/database/schema/support'
// Module toggles live in their own schema file, not the support one (delta D-31).
import { teamModuleSettings } from '~/server/database/schema/teams'

const logger = createLogger('support-inbound')

/** Inbound is webhook traffic, not user traffic - a busy inbox is legitimate. */
const INBOUND_RATE_LIMIT = { maxRequests: 120, windowSeconds: 60, identifier: 'support-inbound' }

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

  if (!(await checkRateLimit(event, INBOUND_RATE_LIMIT))) {
    // 429 is one of the few non-200s that is safe: providers back off on it
    // rather than treating the message as permanently undeliverable.
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

  const { eventId } = claim

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
      await recordInboundRawKey(eventId, rawStorageKey)
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
      await rejectInboundEvent(eventId, `No inbox matches any recipient of ${providerEventId}`)
      return accepted('no-matching-inbox')
    }

    const { inbox, address } = matched
    await attachInboundEventInbox(eventId, inbox.id)

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
      await rejectInboundEvent(eventId, 'Support is disabled for this team')
      return accepted('support-disabled')
    }

    if (!inbox.isEnabled) {
      await rejectInboundEvent(eventId, 'Inbox is disabled')
      return accepted('inbox-disabled')
    }

    // Auto-responses are recorded and dropped: replying to a vacation
    // responder is how mail loops start.
    if (isAutoResponse(message.rawHeaders)) {
      await rejectInboundEvent(eventId, 'Auto-response detected')
      return accepted('auto-response')
    }

    const stripped = stripQuotedReply({ text: message.text, html: message.html })
    const safeHtml = sanitizeInboundHtml(message.html)

    // The inbox's own addresses, so a support address in Cc never becomes a
    // contact or a participant on its own thread.
    const ownAddressRows = await db
      .select({ address: supportInboxAddress.address })
      .from(supportInboxAddress)
      .where(eq(supportInboxAddress.inboxId, inbox.id))
    const ownAddresses = new Set(ownAddressRows.map((row) => row.address.toLowerCase()))

    const result = await db.transaction(async (tx) => {
      // ---- 6. Contact ----------------------------------------------------
      const { contactId } = await resolveOrCreateContact(tx, inbox.teamId, message.from)

      // ---- 7. Conversation -----------------------------------------------
      const thread = await resolveThread(tx, { id: inbox.id, teamId: inbox.teamId }, message, contactId)

      let conversationId = thread.conversationId
      let isNewConversation = false

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
          projectId: address.projectId ?? inbox.projectId ?? null,
          displayId,
          subject: message.subject,
          status: 'open',
          // Agent 2's threading matches replies against this. Writing it is
          // what makes their `thread-key` branch reachable at all.
          channelThreadKey: message.references[0] ?? message.messageId,
          lastActivityAt: message.receivedAt,
          lastCustomerReplyAt: message.receivedAt,
          createdAt: message.receivedAt,
          updatedAt: new Date(),
        })
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

      // ---- SUP-03-11: CC participants -------------------------------------
      await resolveCcParticipants(tx, {
        conversationId,
        teamId: inbox.teamId,
        cc: message.cc,
        senderContactId: contactId,
        ownAddresses,
      })

      return { conversationId, messageId, isNewConversation }
    })

    await publishConversationEvent({
      type: result.isNewConversation ? 'conversation.created' : 'message.created',
      teamId: inbox.teamId,
      inboxId: inbox.id,
      conversationId: result.conversationId,
      messageId: result.messageId,
    })

    // ---- 9. Finish -------------------------------------------------------
    await completeInboundEvent(eventId, result.conversationId)

    setResponseStatus(event, 200)
    return createSuccessResponse({
      accepted: true,
      conversationId: result.conversationId,
      created: result.isNewConversation,
    })
  } catch (error) {
    // Failed and replayable: the lease is cleared so the provider's next retry
    // reclaims it immediately. Still 200 - a 5xx would have the provider retry
    // on its own schedule anyway, and this way the failure is recorded.
    await failInboundEvent(eventId, error)
    logger.error('Inbound processing failed', {
      eventId,
      provider: driver.name,
      error: error instanceof Error ? error.message : error,
    })
    return accepted('processing-failed')
  }
})
