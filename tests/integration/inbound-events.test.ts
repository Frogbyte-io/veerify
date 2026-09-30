import { randomUUID } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { supportEmailEvent } from '../../server/database/schema/support'
import {
  attachInboundEventInbox,
  claimInboundEvent,
  completeInboundEvent,
  failInboundEvent,
  recordInboundRawKey,
  rejectInboundEvent,
  sanitizeEventError,
} from '../../server/utils/inbound-events'

/**
 * The claim is an atomic conditional upsert, so a fake transaction cannot
 * exercise it - the whole property under test is what Postgres does when two
 * deliveries race. Guarded like the other integration suites.
 */

const PROVIDER = 'test-provider'
const created: string[] = []

function eventId() {
  const id = `evt_${randomUUID()}`
  created.push(id)
  return id
}

afterEach(async () => {
  for (const providerEventId of created.splice(0)) {
    await db
      .delete(supportEmailEvent)
      .where(and(eq(supportEmailEvent.provider, PROVIDER), eq(supportEmailEvent.providerEventId, providerEventId)))
  }
})

async function readEvent(providerEventId: string) {
  const [row] = await db
    .select()
    .from(supportEmailEvent)
    .where(and(eq(supportEmailEvent.provider, PROVIDER), eq(supportEmailEvent.providerEventId, providerEventId)))
    .limit(1)
  return row
}

describe('claimInboundEvent', () => {
  it('claims an unseen delivery', async () => {
    const providerEventId = eventId()
    const claim = await claimInboundEvent({ provider: PROVIDER, providerEventId })

    expect(claim.outcome).toBe('claimed')
    const row = await readEvent(providerEventId)
    expect(row.status).toBe('processing')
    expect(row.attemptCount).toBe(1)
    // Nullable on purpose - the inbox is not known at claim time (delta D-35).
    expect(row.inboxId).toBeNull()
  })

  it('reports a retry as in-progress while the lease is live', async () => {
    const providerEventId = eventId()
    await claimInboundEvent({ provider: PROVIDER, providerEventId })

    const second = await claimInboundEvent({ provider: PROVIDER, providerEventId })
    expect(second.outcome).toBe('in-progress')

    // The losing retry must not bump the attempt count; nothing was attempted.
    expect((await readEvent(providerEventId)).attemptCount).toBe(1)
  })

  it('reports a finished delivery as duplicate, forever', async () => {
    const providerEventId = eventId()
    const claim = await claimInboundEvent({ provider: PROVIDER, providerEventId })
    if (claim.outcome !== 'claimed') throw new Error('expected claim')
    await completeInboundEvent({ eventId: claim.eventId, attemptCount: claim.attemptCount }, null)

    expect((await claimInboundEvent({ provider: PROVIDER, providerEventId })).outcome).toBe('duplicate')
    expect((await claimInboundEvent({ provider: PROVIDER, providerEventId })).outcome).toBe('duplicate')
  })

  it('lets a failed delivery be reclaimed immediately', async () => {
    const providerEventId = eventId()
    const first = await claimInboundEvent({ provider: PROVIDER, providerEventId })
    if (first.outcome !== 'claimed') throw new Error('expected claim')
    await failInboundEvent({ eventId: first.eventId, attemptCount: first.attemptCount }, new Error('boom'))

    const retry = await claimInboundEvent({ provider: PROVIDER, providerEventId })
    expect(retry.outcome).toBe('claimed')
    expect((await readEvent(providerEventId)).attemptCount).toBe(2)
  })

  it('reclaims a stale claim whose lease has lapsed', async () => {
    const providerEventId = eventId()
    await claimInboundEvent({ provider: PROVIDER, providerEventId })

    // Simulate a crash mid-processing: the row stays `processing` but its
    // lease expires. Without reclaim the email would be stuck forever.
    await db
      .update(supportEmailEvent)
      .set({ leaseExpiresAt: new Date(Date.now() - 60_000) })
      .where(and(eq(supportEmailEvent.provider, PROVIDER), eq(supportEmailEvent.providerEventId, providerEventId)))

    expect((await claimInboundEvent({ provider: PROVIDER, providerEventId })).outcome).toBe('claimed')
  })

  it('admits exactly one winner when deliveries race', async () => {
    const providerEventId = eventId()

    // The property the unique key plus conditional update exists for: one
    // email must never become two tickets, however hard the provider retries.
    const outcomes = await Promise.all(
      Array.from({ length: 12 }, () => claimInboundEvent({ provider: PROVIDER, providerEventId }))
    )

    expect(outcomes.filter((o) => o.outcome === 'claimed')).toHaveLength(1)
    expect(outcomes.filter((o) => o.outcome !== 'claimed')).toHaveLength(11)
  })

  it('keeps a rejected delivery terminal so it is not replayed', async () => {
    const providerEventId = eventId()
    const claim = await claimInboundEvent({ provider: PROVIDER, providerEventId })
    if (claim.outcome !== 'claimed') throw new Error('expected claim')
    await rejectInboundEvent(
      { eventId: claim.eventId, attemptCount: claim.attemptCount },
      'No inbox matches any recipient'
    )

    const row = await readEvent(providerEventId)
    expect(row.status).toBe('processed')
    expect(row.error).toContain('No inbox matches')
    expect(row.leaseExpiresAt).toBeNull()
    // Retrying an unknown recipient will never succeed, so it must not replay.
    expect((await claimInboundEvent({ provider: PROVIDER, providerEventId })).outcome).toBe('duplicate')
  })

  it('cannot let a stale attempt complete or fail a reclaimed attempt', async () => {
    const providerEventId = eventId()
    const first = await claimInboundEvent({ provider: PROVIDER, providerEventId })
    expect(first.outcome).toBe('claimed')
    if (first.outcome !== 'claimed') throw new Error('expected first claim')

    await db
      .update(supportEmailEvent)
      .set({ leaseExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(supportEmailEvent.id, first.eventId))

    const second = await claimInboundEvent({ provider: PROVIDER, providerEventId })
    expect(second.outcome).toBe('claimed')
    if (second.outcome !== 'claimed') throw new Error('expected reclaimed claim')
    expect(second.attemptCount).toBe(2)

    await expect(
      completeInboundEvent({ eventId: first.eventId, attemptCount: first.attemptCount }, null)
    ).resolves.toBe(false)
    await expect(
      attachInboundEventInbox({ eventId: first.eventId, attemptCount: first.attemptCount }, 'stale-inbox')
    ).resolves.toBe(false)
    await expect(
      recordInboundRawKey({ eventId: first.eventId, attemptCount: first.attemptCount }, 'stale-raw-key')
    ).resolves.toBe(false)
    await expect(
      failInboundEvent({ eventId: first.eventId, attemptCount: first.attemptCount }, new Error('stale'))
    ).resolves.toBe(false)

    const stillCurrent = await readEvent(providerEventId)
    expect(stillCurrent.status).toBe('processing')
    expect(stillCurrent.attemptCount).toBe(2)
    expect(stillCurrent.inboxId).toBeNull()
    expect(stillCurrent.rawStorageKey).toBeNull()

    await expect(
      completeInboundEvent({ eventId: second.eventId, attemptCount: second.attemptCount }, null)
    ).resolves.toBe(true)
    expect((await readEvent(providerEventId)).status).toBe('processed')
  })

  it('rolls back transaction side effects when terminal completion loses the claim', async () => {
    const providerEventId = eventId()
    const first = await claimInboundEvent({ provider: PROVIDER, providerEventId })
    expect(first.outcome).toBe('claimed')
    if (first.outcome !== 'claimed') throw new Error('expected first claim')

    await db
      .update(supportEmailEvent)
      .set({ leaseExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(supportEmailEvent.id, first.eventId))
    const second = await claimInboundEvent({ provider: PROVIDER, providerEventId })
    expect(second.outcome).toBe('claimed')
    if (second.outcome !== 'claimed') throw new Error('expected reclaimed claim')

    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(supportEmailEvent)
          .set({ rawStorageKey: 'must-roll-back' })
          .where(eq(supportEmailEvent.id, first.eventId))
        const completed = await completeInboundEvent(
          { eventId: first.eventId, attemptCount: first.attemptCount },
          null,
          tx
        )
        if (!completed) throw new Error('Inbound claim lost before terminal completion')
      })
    ).rejects.toThrow(/claim/i)

    const row = await readEvent(providerEventId)
    expect(row.rawStorageKey).toBeNull()
    expect(row.status).toBe('processing')
    expect(row.attemptCount).toBe(2)
  })
})

describe('sanitizeEventError', () => {
  it('keeps only the message, never a stack', () => {
    const error = new Error('parse failed')
    const sanitized = sanitizeEventError(error)

    expect(sanitized).toBe('parse failed')
    // The stack can carry file paths and, via a cause chain, fragments of the
    // email itself. This column is surfaced in the support UI, so none of it
    // may leak through. Assert against stack-frame markers rather than the
    // word "at", which legitimately appears in prose messages.
    expect(error.stack).toContain('.ts')
    expect(sanitized).not.toContain('.ts')
    expect(sanitized).not.toContain('inbound-events')
  })

  it('collapses whitespace and bounds the length', () => {
    expect(sanitizeEventError('a\n\n  b')).toBe('a b')
    expect(sanitizeEventError('x'.repeat(900))).toHaveLength(500)
  })

  it('handles non-errors', () => {
    expect(sanitizeEventError(null)).toBe('Unknown inbound processing error')
    expect(sanitizeEventError({ nope: true })).toBe('Unknown inbound processing error')
  })
})
