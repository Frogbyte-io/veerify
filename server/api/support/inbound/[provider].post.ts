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
import { createError, getHeaders, getRouterParam, readMultipartFormData, readRawBody, setResponseStatus } from 'h3'
import { eq } from 'drizzle-orm'
import { createLogger } from '~/server/utils/logger'
import { createSuccessResponse } from '~/server/utils/response'
import { getChannelDriver, type InboundMessage } from '~/server/services/support-channels'
import { resolveInboxForRecipients } from '~/server/utils/support-access'
import { DEFAULT_MAIL_ADDRESS_BEHAVIOUR, isMailAddressBehaviour, type MailAddressBehaviour } from '~/lib/mail-address'
import { stripQuotedReply } from '~/server/utils/inbound-content'
import { sanitizeInboundHtml } from '~/server/utils/inbound-sanitize'
import { isAutoResponse } from '~/server/utils/inbound-autoresponse'
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
import { getStorageProvider } from '~/server/utils/storage'
import { announceInboundMessage, fileInboundMessage } from '~/server/utils/inbound-intake'
import { db } from '~/server/database/drizzle'
import { projectMailAddress } from '~/server/database/schema/support'
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

      // ---- 6-8. Contact, conversation, message, Cc, auto-reply -----------
      const filed = await fileInboundMessage(tx, {
        inbox,
        mailAddressId: matchedAddress.id,
        behaviour: addressBehaviour,
        message,
        body: stripped.body,
        bodyHtml: safeHtml,
        threading: 'thread',
        ownAddresses,
        attachments: attachments.stored,
        messageMetadata: {
          rawBody: stripped.rawBody,
          ...(message.isSpam ? { spam: true } : {}),
          ...(message.frogmailForwards?.length ? { frogmailForwards: message.frogmailForwards } : {}),
          ...(message.attachmentsRemoved ? { attachmentsRemoved: true } : {}),
        },
        logContext: { provider: driver.name },
      })

      const completed = await completeInboundEvent(claimToken, filed.conversationId, tx)
      if (!completed) {
        throw new Error('Inbound claim lost before terminal completion')
      }

      return filed
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

    await announceInboundMessage(inbox, result)

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
