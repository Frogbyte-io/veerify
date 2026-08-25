import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { conversation, conversationMessage, supportOutboundDelivery } from '~/server/database/schema/support'
import { sendEmail as defaultSendEmail, type EmailAttachment, type SendEmailOptions } from '~/lib/email'
import { getStorageProvider } from '~/server/utils/storage'
import { publishConversationEvent } from '~/server/utils/support-realtime'
import { createLogger } from '~/server/utils/logger'

const logger = createLogger('outbound-delivery')

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Durable outbound-delivery outbox (design.md, delta D-21).
 *
 * Message insertion and outbox enqueue are one transaction (`enqueueOutboundDelivery`
 * is called with the caller's `tx`); a worker claims and retries delivery, so a
 * request-lifetime background promise is never the only copy of "this needs sending".
 *
 * `payload` carries attachments as storage-key *references*
 * (`OutboundAttachment`), never resolved bytes - `lib/email.ts`'s `EmailAttachment`
 * is the resolved-bytes shape, and resolving a key to bytes is this module's job,
 * not the enqueuing endpoint's.
 */

/** One attachment reference in a queued delivery's payload - a storage key, not bytes. */
export interface OutboundAttachment {
  filename: string
  contentType?: string
  storageKey: string
  cid?: string
}

/** Everything the worker needs to send one message, minus resolved attachment bytes. */
export interface OutboundDeliveryPayload {
  to: string | string[]
  cc?: string[]
  subject: string
  html?: string
  text?: string
  from?: { address: string; name?: string }
  replyTo?: string
  headers?: Record<string, string>
  attachments?: OutboundAttachment[]
}

/** How long a claim is held before another worker pass may take it over. */
export const OUTBOUND_DELIVERY_CLAIM_LEASE_SECONDS = 5 * 60

/** Attempts before a delivery stops retrying and becomes terminal. */
export const MAX_DELIVERY_ATTEMPTS = 5

/**
 * Insert a pending delivery inside the caller's transaction.
 *
 * Called from the same transaction that inserts the `conversationMessage`
 * (SUP-04-4) so a message never exists without something that will attempt to
 * send it. The unique `(messageId, kind)` index is the actual guarantee -
 * this function does not itself defend against a duplicate enqueue.
 */
export async function enqueueOutboundDelivery(
  tx: Tx,
  input: { messageId: string; kind?: string; payload: OutboundDeliveryPayload; idempotencyKey?: string }
): Promise<void> {
  const now = new Date()
  await tx.insert(supportOutboundDelivery).values({
    id: randomUUID(),
    messageId: input.messageId,
    kind: input.kind ?? 'email',
    payload: input.payload,
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
    createdAt: now,
    updatedAt: now,
  })
}

export interface OutboundClaim {
  id: string
  messageId: string
  kind: string
  payload: OutboundDeliveryPayload
  idempotencyKey: string
  attemptCount: number
}

/**
 * Atomically take the oldest claimable delivery: pending, under the attempt
 * cap, and either never leased or its lease has lapsed.
 *
 * `FOR UPDATE SKIP LOCKED` inside the subquery is what lets several worker
 * passes run concurrently without two of them claiming the same row - a
 * locked row is invisible to a concurrent claim rather than making it wait
 * and then reclaim nothing, which a plain `WHERE` would do.
 */
export async function claimNextOutboundDelivery(): Promise<OutboundClaim | null> {
  const now = new Date()
  const leaseExpiresAt = new Date(now.getTime() + OUTBOUND_DELIVERY_CLAIM_LEASE_SECONDS * 1000)

  const result = await db.execute<{
    id: string
    message_id: string
    kind: string
    payload: OutboundDeliveryPayload
    idempotency_key: string
    attempt_count: number
  }>(sql`
    UPDATE support_outbound_delivery
    SET attempt_count = attempt_count + 1, lease_expires_at = ${leaseExpiresAt}, updated_at = ${now}
    WHERE id = (
      SELECT id FROM support_outbound_delivery
      WHERE status = 'pending'
        AND attempt_count < ${MAX_DELIVERY_ATTEMPTS}
        AND (lease_expires_at IS NULL OR lease_expires_at < ${now})
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, message_id, kind, payload, idempotency_key, attempt_count
  `)

  const row = result.rows[0]
  if (!row) return null

  return {
    id: row.id,
    messageId: row.message_id,
    kind: row.kind,
    payload: row.payload,
    idempotencyKey: row.idempotency_key,
    attemptCount: row.attempt_count,
  }
}

/**
 * Push the outbox status onto its `supportOutboundDelivery` row and the
 * `conversationMessage` the UI actually reads, in one transaction so the two
 * never observably disagree.
 *
 * SUP-04-10 note: before this, nothing ever updated `conversationMessage.
 * deliveryStatus` past its initial insert-time value - `completeOutboundDelivery`
 * and `failOutboundDelivery` only touched the outbox row. A message would sit
 * at `'pending'` forever regardless of whether it actually sent. See the
 * landing note in `parallel-agents.md` for the full story.
 */
async function applyDeliveryOutcome(input: {
  deliveryId: string
  messageId: string
  deliveryPatch: Partial<typeof supportOutboundDelivery.$inferInsert>
  messagePatch: Partial<typeof conversationMessage.$inferInsert>
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(supportOutboundDelivery)
      .set(input.deliveryPatch)
      .where(eq(supportOutboundDelivery.id, input.deliveryId))
    await tx.update(conversationMessage).set(input.messagePatch).where(eq(conversationMessage.id, input.messageId))
  })
}

/**
 * Notify the thread/list UI that a message's delivery status changed.
 *
 * Fire-and-forget and never throws: a realtime publish failure must not turn
 * a successful (or correctly recorded failed) send into a 500, and nothing
 * here is in the critical path of `deliveryStatus` actually being correct -
 * that already committed before this runs. Looks up `teamId`/`inboxId` fresh
 * because this module only ever has a bare `messageId` to work from.
 *
 * Exported (SUP-04-9): the delivery/bounce webhook endpoint updates
 * `conversationMessage.deliveryStatus` too, via its own path (it has no
 * `supportOutboundDelivery` row to pair the update with - `applyDeliveryOutcome`
 * above is specific to that pairing), but the agent UI needs the same
 * notification either way.
 */
export async function publishDeliveryStatusChanged(messageId: string): Promise<void> {
  try {
    const [row] = await db
      .select({ teamId: conversation.teamId, inboxId: conversation.inboxId, conversationId: conversation.id })
      .from(conversationMessage)
      .innerJoin(conversation, eq(conversationMessage.conversationId, conversation.id))
      .where(eq(conversationMessage.id, messageId))
      .limit(1)
    if (!row) return

    await publishConversationEvent({
      type: 'message.delivery-status',
      teamId: row.teamId,
      inboxId: row.inboxId,
      conversationId: row.conversationId,
      messageId,
    })
  } catch (error) {
    logger.error('Failed to publish delivery status update', {
      messageId,
      error: error instanceof Error ? error.message : error,
    })
  }
}

/** Mark a delivery sent. Terminal - never claimed again. */
export async function completeOutboundDelivery(id: string, messageId: string): Promise<void> {
  await applyDeliveryOutcome({
    deliveryId: id,
    messageId,
    deliveryPatch: { status: 'sent', leaseExpiresAt: null, lastError: null, updatedAt: new Date() },
    messagePatch: { deliveryStatus: 'sent', deliveryError: null },
  })
  await publishDeliveryStatusChanged(messageId)
}

/**
 * Record a failed send attempt.
 *
 * Below `MAX_DELIVERY_ATTEMPTS`, the row stays `pending` with its lease
 * cleared so the next worker pass can reclaim it immediately rather than
 * waiting out the lease. At the cap it becomes terminal `failed` - retrying
 * forever on a permanently-rejecting address is not a retry policy.
 *
 * `conversationMessage.deliveryStatus` mirrors the same pending/failed split:
 * a below-cap failure is not yet visible to the agent as "failed" (it will
 * auto-retry), so only a terminal failure changes what the UI shows - and
 * only a terminal failure is worth a realtime publish, since a non-terminal
 * one leaves `deliveryStatus` unchanged.
 */
export async function failOutboundDelivery(
  id: string,
  messageId: string,
  error: unknown,
  attemptCount: number
): Promise<void> {
  const terminal = attemptCount >= MAX_DELIVERY_ATTEMPTS
  const sanitized = sanitizeDeliveryError(error)

  await applyDeliveryOutcome({
    deliveryId: id,
    messageId,
    deliveryPatch: {
      status: terminal ? 'failed' : 'pending',
      leaseExpiresAt: null,
      lastError: sanitized,
      updatedAt: new Date(),
    },
    messagePatch: { deliveryStatus: terminal ? 'failed' : 'pending', deliveryError: sanitized },
  })

  if (terminal) await publishDeliveryStatusChanged(messageId)
}

/**
 * Bring a terminal `failed` delivery back to `pending` with a clean attempt
 * count, so the next worker pass claims it as if newly enqueued.
 *
 * For SUP-04-10's retry action: an agent-initiated retry is a deliberate
 * decision to try again from scratch, not "one more of the same automatic
 * attempts" - resetting `attemptCount` rather than just clearing the lease is
 * what distinguishes it from `failOutboundDelivery`'s own below-the-cap path.
 */
export async function resetOutboundDeliveryForRetry(id: string, messageId: string): Promise<void> {
  await applyDeliveryOutcome({
    deliveryId: id,
    messageId,
    deliveryPatch: { status: 'pending', attemptCount: 0, leaseExpiresAt: null, lastError: null, updatedAt: new Date() },
    messagePatch: { deliveryStatus: 'pending', deliveryError: null },
  })
  await publishDeliveryStatusChanged(messageId)
}

/** Maximum stored error length. Enough to diagnose, short of storing a payload. */
const MAX_ERROR_LENGTH = 500

/**
 * Reduce a delivery failure to a short, storable string. Only the message is
 * kept, matching `sanitizeEventError` in `inbound-events.ts` - never the stack
 * or cause chain, and never the payload itself.
 */
export function sanitizeDeliveryError(error: unknown): string {
  const raw =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown outbound delivery error'

  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_LENGTH)
}

export type SendEmailFn = (options: SendEmailOptions) => Promise<{ success: boolean; message: string; error?: unknown }>
export type GetObjectFn = (storageKey: string) => Promise<Buffer>

export interface ProcessOutboundDeliveryDeps {
  /** Defaults to the real `sendEmail` - injectable so tests never touch `useNodeMailer()`. */
  sendEmail?: SendEmailFn
  /** Defaults to the real storage provider - injectable so tests never touch disk/S3. */
  getObject?: GetObjectFn
  /** Defaults to `completeOutboundDelivery` - injectable so unit tests never touch the db. */
  onSent?: (id: string, messageId: string) => Promise<void>
  /** Defaults to `failOutboundDelivery` - injectable so unit tests never touch the db. */
  onFailed?: (id: string, messageId: string, error: unknown, attemptCount: number) => Promise<void>
}

/**
 * Send one claimed delivery: resolve its attachment storage keys to bytes,
 * call `sendEmail`, and record the outcome.
 *
 * Every dependency is injectable (default: the real implementation) so this
 * is fully unit-testable - `sendEmail` needs Nitro's `useNodeMailer()`
 * auto-import and `getStorageProvider()` needs disk/S3, neither of which
 * exist under plain vitest.
 */
export async function processOutboundDelivery(
  claim: OutboundClaim,
  deps: ProcessOutboundDeliveryDeps = {}
): Promise<{ outcome: 'sent' } | { outcome: 'failed'; error: string }> {
  // `sendEmail`'s inferred return type includes `Response`, from its
  // `import.meta.client` branch that fetches `/api/mail/send-mail` instead of
  // calling nodemailer directly. This worker only ever runs server-side
  // (Nitro scheduled task or API route), so that branch is unreachable here -
  // the cast narrows to the branch that actually runs, it does not paper over
  // a real mismatch.
  const send = deps.sendEmail ?? (defaultSendEmail as SendEmailFn)
  const getObject = deps.getObject ?? ((key: string) => getStorageProvider().getObject(key))
  const onSent = deps.onSent ?? completeOutboundDelivery
  const onFailed = deps.onFailed ?? failOutboundDelivery

  try {
    const attachments: EmailAttachment[] | undefined = claim.payload.attachments
      ? await Promise.all(
          claim.payload.attachments.map(async (attachment) => ({
            filename: attachment.filename,
            contentType: attachment.contentType,
            cid: attachment.cid,
            content: await getObject(attachment.storageKey),
          }))
        )
      : undefined

    const result = await send({
      to: claim.payload.to,
      cc: claim.payload.cc,
      subject: claim.payload.subject,
      html: claim.payload.html,
      text: claim.payload.text,
      from: claim.payload.from,
      replyTo: claim.payload.replyTo,
      // SMTP does not provide a portable idempotency API. Carry the durable
      // key as a stable, traceable header alongside the already-stable
      // Message-ID so provider webhooks and support investigations can
      // correlate every retry to one queued delivery.
      headers: { ...claim.payload.headers, 'X-Veerify-Idempotency-Key': claim.idempotencyKey },
      attachments,
    })

    if (result.success) {
      await onSent(claim.id, claim.messageId)
      return { outcome: 'sent' }
    }

    await onFailed(claim.id, claim.messageId, result.error ?? result.message, claim.attemptCount)
    return { outcome: 'failed', error: sanitizeDeliveryError(result.error ?? result.message) }
  } catch (error) {
    await onFailed(claim.id, claim.messageId, error, claim.attemptCount)
    return { outcome: 'failed', error: sanitizeDeliveryError(error) }
  }
}

/** One worker pass may claim and send at most this many deliveries. */
export const DEFAULT_WORKER_MAX_BATCH = 10

export interface RunOutboundDeliveryWorkerDeps {
  /** Defaults to `claimNextOutboundDelivery` - injectable so unit tests never touch the db. */
  claimNext?: () => Promise<OutboundClaim | null>
  /** Defaults to `processOutboundDelivery` - injectable so unit tests never touch the db, storage or SMTP. */
  process?: (claim: OutboundClaim) => ReturnType<typeof processOutboundDelivery>
  /** Upper bound on deliveries claimed in one pass, so a runaway queue cannot make one invocation run forever. */
  maxBatch?: number
}

/**
 * Claim and send deliveries until the queue is empty or `maxBatch` is
 * reached, whichever comes first.
 *
 * Bounded on purpose: an unbounded loop under a scheduled trigger risks one
 * invocation running until the platform kills it while newer deliveries pile
 * up behind it. A bounded pass that runs again next tick drains a backlog
 * just as completely, without that failure mode.
 */
export async function runOutboundDeliveryWorker(
  deps: RunOutboundDeliveryWorkerDeps = {}
): Promise<{ processed: number }> {
  const claimNext = deps.claimNext ?? claimNextOutboundDelivery
  const process = deps.process ?? processOutboundDelivery
  const maxBatch = deps.maxBatch ?? DEFAULT_WORKER_MAX_BATCH

  let processed = 0
  for (let i = 0; i < maxBatch; i++) {
    const claim = await claimNext()
    if (!claim) break

    await process(claim)
    processed++
  }

  return { processed }
}
