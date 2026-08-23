import { randomUUID } from 'node:crypto'
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { supportDeliveryEvent } from '~/server/database/schema/support'

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
 * nullable: the lookup that resolves it may legitimately find nothing (see
 * `DeliveryEvent.messageId`'s doc comment on the SMTP-relay correlation
 * assumption this whole item rests on).
 */

/** How long a claim is held before another delivery may take it over. */
export const CLAIM_LEASE_SECONDS = 5 * 60

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
  providerEventId: string
  recordType: string
  recipient: string
  messageId: string | null
}): Promise<DeliveryEventClaimOutcome> {
  const now = new Date()
  const leaseExpiresAt = new Date(now.getTime() + CLAIM_LEASE_SECONDS * 1000)
  const id = randomUUID()

  const [claimed] = await db
    .insert(supportDeliveryEvent)
    .values({
      id,
      provider: input.provider,
      providerEventId: input.providerEventId,
      recordType: input.recordType,
      recipient: input.recipient,
      messageId: input.messageId,
      status: 'processing',
      attemptCount: 1,
      leaseExpiresAt,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [supportDeliveryEvent.provider, supportDeliveryEvent.providerEventId],
      set: {
        status: 'processing',
        recordType: input.recordType,
        recipient: input.recipient,
        messageId: input.messageId,
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

/** Finish an event successfully. */
export async function completeDeliveryEvent(eventId: string): Promise<void> {
  await db
    .update(supportDeliveryEvent)
    .set({
      status: 'processed',
      processedAt: new Date(),
      // Drop the lease: a processed row is never reclaimed.
      leaseExpiresAt: null,
      error: null,
    })
    .where(eq(supportDeliveryEvent.id, eventId))
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
export async function failDeliveryEvent(eventId: string, error: unknown): Promise<void> {
  await db
    .update(supportDeliveryEvent)
    .set({
      status: 'failed',
      leaseExpiresAt: null,
      error: sanitizeDeliveryEventError(error),
    })
    .where(eq(supportDeliveryEvent.id, eventId))
}
