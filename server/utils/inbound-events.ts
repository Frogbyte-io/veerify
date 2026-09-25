import { randomUUID } from 'node:crypto'
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { supportEmailEvent } from '~/server/database/schema/support'

/**
 * Claim/replay state for inbound webhook deliveries.
 *
 * Mail providers retry aggressively, so the unique key on
 * `(provider, providerEventId)` is what stops one email becoming two tickets.
 * A unique key alone is not enough though: a crash between claiming an event
 * and finishing it would otherwise wedge that email forever, since the row
 * exists but nothing was created. The lease is what makes such a claim
 * reclaimable.
 *
 * `inboxId` is nullable here on purpose (delta D-35) — the row is keyed on the
 * delivery, and the recipient inbox is something processing may discover, or
 * may legitimately never discover.
 */

/** How long a claim is held before another delivery may take it over. */
export const INBOUND_EVENT_CLAIM_LEASE_SECONDS = 5 * 60

export type InboundClaimOutcome =
  /** This request owns the event and must process it. */
  | { outcome: 'claimed'; eventId: string; attemptCount: number }
  /** Already finished. Return 200 and do nothing — the provider is retrying. */
  | { outcome: 'duplicate'; eventId: string }
  /** Another delivery holds a live lease. Return 200; it is being handled. */
  | { outcome: 'in-progress'; eventId: string }

export type InboundClaimToken = {
  eventId: string
  attemptCount: number
}

type InboundExecutor = Pick<Parameters<Parameters<typeof db.transaction>[0]>[0], 'update'>

const defaultExecutor: InboundExecutor = db

/**
 * Atomically take ownership of an inbound delivery.
 *
 * The insert and the takeover are one statement so two concurrent deliveries
 * of the same email cannot both win. `ON CONFLICT ... WHERE` is what makes the
 * takeover conditional: it only reclaims a row that is unfinished *and* whose
 * lease has lapsed, so a live claim is never stolen and a processed one is
 * never redone.
 */
export async function claimInboundEvent(input: {
  provider: string
  providerEventId: string
  inboxId?: string | null
}): Promise<InboundClaimOutcome> {
  const now = new Date()
  const leaseExpiresAt = new Date(now.getTime() + INBOUND_EVENT_CLAIM_LEASE_SECONDS * 1000)
  const id = randomUUID()

  const [claimed] = await db
    .insert(supportEmailEvent)
    .values({
      id,
      inboxId: input.inboxId ?? null,
      provider: input.provider,
      providerEventId: input.providerEventId,
      status: 'processing',
      attemptCount: 1,
      leaseExpiresAt,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [supportEmailEvent.provider, supportEmailEvent.providerEventId],
      set: {
        status: 'processing',
        attemptCount: sql`${supportEmailEvent.attemptCount} + 1`,
        leaseExpiresAt,
      },
      // Reclaim only an unfinished event whose lease has expired. Without this
      // a retry arriving mid-processing would take the claim from the request
      // still working on it, and both would create a ticket.
      setWhere: and(
        sql`${supportEmailEvent.status} <> 'processed'`,
        or(isNull(supportEmailEvent.leaseExpiresAt), lt(supportEmailEvent.leaseExpiresAt, now))
      ),
    })
    .returning({ id: supportEmailEvent.id, attemptCount: supportEmailEvent.attemptCount })

  if (claimed) {
    return { outcome: 'claimed', eventId: claimed.id, attemptCount: claimed.attemptCount }
  }

  // The conditional update matched nothing, so the row exists and was not
  // reclaimable. Read it to say which of the two reasons applies.
  const [existing] = await db
    .select({ id: supportEmailEvent.id, status: supportEmailEvent.status })
    .from(supportEmailEvent)
    .where(
      and(eq(supportEmailEvent.provider, input.provider), eq(supportEmailEvent.providerEventId, input.providerEventId))
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

/** Attach the resolved inbox once parsing has revealed it. */
export async function attachInboundEventInbox(
  claim: InboundClaimToken,
  inboxId: string,
  executor: InboundExecutor = defaultExecutor
): Promise<boolean> {
  const [updated] = await executor
    .update(supportEmailEvent)
    .set({ inboxId })
    .where(
      and(
        eq(supportEmailEvent.id, claim.eventId),
        eq(supportEmailEvent.attemptCount, claim.attemptCount),
        eq(supportEmailEvent.status, 'processing')
      )
    )
    .returning({ id: supportEmailEvent.id })

  return Boolean(updated)
}

/** Record where the raw payload was archived, before parsing is attempted. */
export async function recordInboundRawKey(
  claim: InboundClaimToken,
  rawStorageKey: string,
  executor: InboundExecutor = defaultExecutor
): Promise<boolean> {
  const [updated] = await executor
    .update(supportEmailEvent)
    .set({ rawStorageKey })
    .where(
      and(
        eq(supportEmailEvent.id, claim.eventId),
        eq(supportEmailEvent.attemptCount, claim.attemptCount),
        eq(supportEmailEvent.status, 'processing')
      )
    )
    .returning({ id: supportEmailEvent.id })

  return Boolean(updated)
}

/** Finish an event successfully. `conversationId` is null when nothing was created by design. */
export async function completeInboundEvent(
  claim: InboundClaimToken,
  conversationId: string | null,
  executor: InboundExecutor = defaultExecutor
): Promise<boolean> {
  const [updated] = await executor
    .update(supportEmailEvent)
    .set({
      status: 'processed',
      processedAt: new Date(),
      resultConversationId: conversationId,
      // Drop the lease: a processed row is never reclaimed, and leaving a
      // future timestamp on it only misleads whoever reads the table.
      leaseExpiresAt: null,
      error: null,
    })
    .where(
      and(
        eq(supportEmailEvent.id, claim.eventId),
        eq(supportEmailEvent.attemptCount, claim.attemptCount),
        eq(supportEmailEvent.status, 'processing')
      )
    )
    .returning({ id: supportEmailEvent.id })

  return Boolean(updated)
}

/**
 * Mark an event finished-but-rejected: signature-valid mail we deliberately
 * created nothing for (unknown recipient, support disabled). Terminal on
 * purpose — retrying will not change the outcome, so it must not be replayed.
 */
export async function rejectInboundEvent(
  claim: InboundClaimToken,
  reason: string,
  executor: InboundExecutor = defaultExecutor
): Promise<boolean> {
  const [updated] = await executor
    .update(supportEmailEvent)
    .set({
      status: 'processed',
      processedAt: new Date(),
      leaseExpiresAt: null,
      error: sanitizeEventError(reason),
    })
    .where(
      and(
        eq(supportEmailEvent.id, claim.eventId),
        eq(supportEmailEvent.attemptCount, claim.attemptCount),
        eq(supportEmailEvent.status, 'processing')
      )
    )
    .returning({ id: supportEmailEvent.id })

  return Boolean(updated)
}

/**
 * Mark an event failed and replayable. The lease is cleared so the provider's
 * next retry can reclaim it immediately rather than waiting it out.
 */
export async function failInboundEvent(
  claim: InboundClaimToken,
  error: unknown,
  executor: InboundExecutor = defaultExecutor
): Promise<boolean> {
  const [updated] = await executor
    .update(supportEmailEvent)
    .set({
      status: 'failed',
      leaseExpiresAt: null,
      error: sanitizeEventError(error),
    })
    .where(
      and(
        eq(supportEmailEvent.id, claim.eventId),
        eq(supportEmailEvent.attemptCount, claim.attemptCount),
        eq(supportEmailEvent.status, 'processing')
      )
    )
    .returning({ id: supportEmailEvent.id })

  return Boolean(updated)
}

/** Maximum stored error length. Enough to diagnose, short of storing a payload. */
const MAX_ERROR_LENGTH = 500

/**
 * Reduce an error to a short, storable string.
 *
 * Only the message is kept, never the stack or the cause chain: those can
 * carry fragments of the email body, and this column is read in the support
 * UI by people who should not be shown a customer's message contents through
 * a debugging field.
 */
export function sanitizeEventError(error: unknown): string {
  const raw =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown inbound processing error'

  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_LENGTH)
}
