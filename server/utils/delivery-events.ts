import { randomUUID } from 'node:crypto'
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { conversationMessage, supportDeliveryEvent } from '~/server/database/schema/support'
import { markDeliveryMessageBounced, markDeliveryMessageDelivered } from '~/server/utils/delivery-status'

/**
 * Claim/replay state for delivery, bounce, and engagement webhook events
 * (SUP-04-9), mirroring `inbound-events.ts`'s claim/lease pattern - a
 * unique key alone is not enough, because a crash between claiming an event
 * and finishing it would otherwise wedge it forever.
 *
 * One structural difference from inbound: parsing here (`ChannelDriver.
 * parseDeliveryEvent`) is pure and in-memory, with no raw-body archival step
 * and no side effects, so it is safe to parse *before* claiming. That means
 * `recordType` and `recipient` - real `NOT NULL` columns - are already known
 * at claim time, unlike inbound's `inboxId` (delta D-35), which is
 * discovered mid-pipeline and therefore nullable. `messageId` is still
 * nullable because a signature-valid event may not correlate to this
 * deployment's outbox and is recorded rather than discarded.
 */

/** How long a claim is held before another delivery may take it over. */
export const DELIVERY_EVENT_CLAIM_LEASE_SECONDS = 5 * 60

export type DeliveryEventClaimOutcome =
  | { outcome: 'claimed'; eventId: string; attemptCount: number }
  | { outcome: 'duplicate'; eventId: string }
  | { outcome: 'in-progress'; eventId: string }

/**
 * Atomically take ownership of a delivery event.
 *
 * `ON CONFLICT ... WHERE` is the same conditional-takeover shape as
 * `claimInboundEvent`: it only reclaims a row that is unfinished *and* whose
 * lease has lapsed, so a live claim is never stolen and a processed one is
 * never redone.
 */
export async function claimDeliveryEvent(input: {
  provider: string
  providerAccountKey?: string
  providerEventId: string
  correlationKey?: string | null
  recordType: string
  recipient: string
  messageId: string | null
  occurredAt?: Date
}): Promise<DeliveryEventClaimOutcome> {
  const now = new Date()
  const leaseExpiresAt = new Date(now.getTime() + DELIVERY_EVENT_CLAIM_LEASE_SECONDS * 1000)
  const id = randomUUID()

  const [claimed] = await db
    .insert(supportDeliveryEvent)
    .values({
      id,
      provider: input.provider,
      providerAccountKey: input.providerAccountKey ?? 'legacy',
      providerEventId: input.providerEventId,
      correlationKey: input.correlationKey,
      recordType: input.recordType,
      recipient: input.recipient,
      messageId: input.messageId,
      occurredAt: input.occurredAt ?? now,
      status: 'processing',
      attemptCount: 1,
      leaseExpiresAt,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [supportDeliveryEvent.provider, supportDeliveryEvent.providerAccountKey, supportDeliveryEvent.providerEventId],
      set: {
        status: 'processing',
        recordType: input.recordType,
        recipient: input.recipient,
        messageId: input.messageId,
        correlationKey: input.correlationKey,
        occurredAt: input.occurredAt ?? now,
        attemptCount: sql`${supportDeliveryEvent.attemptCount} + 1`,
        leaseExpiresAt,
      },
      setWhere: and(
        sql`${supportDeliveryEvent.status} <> 'processed'`,
        or(isNull(supportDeliveryEvent.leaseExpiresAt), lt(supportDeliveryEvent.leaseExpiresAt, now))
      ),
    })
    .returning({ id: supportDeliveryEvent.id, attemptCount: supportDeliveryEvent.attemptCount })

  if (claimed) {
    return { outcome: 'claimed', eventId: claimed.id, attemptCount: claimed.attemptCount }
  }

  const [existing] = await db
    .select({ id: supportDeliveryEvent.id, status: supportDeliveryEvent.status })
    .from(supportDeliveryEvent)
    .where(
      and(
        eq(supportDeliveryEvent.provider, input.provider),
        eq(supportDeliveryEvent.providerAccountKey, input.providerAccountKey ?? 'legacy'),
        eq(supportDeliveryEvent.providerEventId, input.providerEventId)
      )
    )
    .limit(1)

  if (!existing) {
    // Only reachable if the row vanished between the two statements. Treat it
    // as in-progress rather than inventing a claim we do not hold.
    return { outcome: 'in-progress', eventId: id }
  }

  return existing.status === 'processed'
    ? { outcome: 'duplicate', eventId: existing.id }
    : { outcome: 'in-progress', eventId: existing.id }
}

type DeliveryEventExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Apply one correlated event; the guarded status update makes hard bounce terminal and activity idempotent. */
export async function applyDeliveryEventStatus(
  executor: DeliveryEventExecutor,
  input: {
    messageId: string
    conversationId: string
    recordType: string
    bounceType: 'hard' | 'soft' | null
    description: string | null
  }
): Promise<boolean> {
  if (input.recordType === 'delivered') return markDeliveryMessageDelivered(executor, input.messageId)
  if (input.recordType !== 'bounced' || input.bounceType !== 'hard') return false

  const changed = await markDeliveryMessageBounced(executor, input.messageId, input.description)
  if (changed) {
    await executor.insert(conversationMessage).values({
      id: randomUUID(),
      conversationId: input.conversationId,
      kind: 'activity',
      body: input.description
        ? `Delivery failed: ${input.description}`
        : 'Delivery failed: the message was not delivered.',
      senderKind: 'system',
      senderUserId: null,
      isPrivate: true,
      createdAt: new Date(),
    })
  }
  return changed
}

/** Finish only the still-owned attempt. */
export async function completeDeliveryEvent(
  eventId: string,
  attemptCount: number,
  executor: DeliveryEventExecutor = db
): Promise<void> {
  const [completed] = await executor
    .update(supportDeliveryEvent)
    .set({
      status: 'processed',
      processedAt: new Date(),
      // Drop the lease: a processed row is never reclaimed.
      leaseExpiresAt: null,
      error: null,
    })
    .where(
      and(
        eq(supportDeliveryEvent.id, eventId),
        eq(supportDeliveryEvent.attemptCount, attemptCount),
        eq(supportDeliveryEvent.status, 'processing')
      )
    )
    .returning({ id: supportDeliveryEvent.id })

  if (!completed) throw new Error('Delivery event ownership lost')
}

/** Maximum stored error length. Enough to diagnose, short of storing a payload. */
const MAX_ERROR_LENGTH = 500

/** Reduce an error to a short, storable string. Matches `sanitizeEventError` in `inbound-events.ts`. */
export function sanitizeDeliveryEventError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown delivery event processing error'

  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_LENGTH)
}

/**
 * Mark an event failed and replayable. The lease is cleared so the
 * provider's next retry can reclaim it immediately rather than waiting it out.
 */
export async function failDeliveryEvent(
  eventId: string,
  attemptCount: number,
  error: unknown,
  executor: DeliveryEventExecutor = db
): Promise<boolean> {
  const [failed] = await executor
    .update(supportDeliveryEvent)
    .set({
      status: 'failed',
      leaseExpiresAt: null,
      error: sanitizeDeliveryEventError(error),
    })
    .where(
      and(
        eq(supportDeliveryEvent.id, eventId),
        eq(supportDeliveryEvent.attemptCount, attemptCount),
        eq(supportDeliveryEvent.status, 'processing')
      )
    )
    .returning({ id: supportDeliveryEvent.id })

  return Boolean(failed)
}
