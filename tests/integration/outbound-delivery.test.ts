import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, team } from '../../server/database/schema/auth'
import {
  contact,
  conversation,
  conversationAttachment,
  conversationMessage,
  supportInbox,
  supportOutboundDelivery,
} from '../../server/database/schema/support'
import {
  MAX_DELIVERY_ATTEMPTS,
  claimNextOutboundDelivery,
  completeOutboundDelivery,
  enqueueOutboundDelivery,
  failOutboundDelivery,
  processOutboundDelivery,
  reapAbandonedOutboundDeliveries,
  resetOutboundDeliveryForRetry,
  runOutboundDeliveryWorker,
} from '../../server/utils/outbound-delivery'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * The claim is an atomic `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP
 * LOCKED)`, so a fake transaction cannot exercise what Postgres actually does
 * under it. Guarded like the other integration suites: skips cleanly when no
 * database is reachable.
 */
describe('outbound delivery outbox (real Postgres)', () => {
  const orgId = `org_outbound_${randomUUID()}`
  const teamId = `team_outbound_${randomUUID()}`
  const inboxId = `inbox_outbound_${randomUUID()}`
  const contactId = `contact_outbound_${randomUUID()}`
  const conversationId = `conv_outbound_${randomUUID()}`
  const now = new Date()

  function newMessage() {
    return `msg_outbound_${randomUUID()}`
  }

  async function insertMessage(id: string) {
    await db.insert(conversationMessage).values({
      id,
      conversationId,
      kind: 'outgoing',
      body: 'Reply body',
      senderKind: 'agent',
      createdAt: now,
    })
  }

  beforeAll(async () => {
    await db.insert(organization).values({ id: orgId, name: 'Outbound Org', slug: `outbound-org-${randomUUID()}` })
    await db
      .insert(team)
      .values({ id: teamId, name: 'Outbound Team', slug: `outbound-team-${randomUUID()}`, organizationId: orgId })
    await db.insert(supportInbox).values({
      id: inboxId,
      teamId,
      name: 'Outbound Inbox',
      slug: `outbound-inbox-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(contact).values({
      id: contactId,
      teamId,
      name: 'Jane',
      email: `jane-${randomUUID()}@example.com`,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(conversation).values({
      id: conversationId,
      inboxId,
      teamId,
      contactId,
      displayId: 9101,
      subject: 'Outbound test',
      status: 'open',
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    })
  })

  afterAll(async () => {
    // organization → team → inbox/contact/conversation → messages → outbox all cascade.
    await db.delete(organization).where(eq(organization.id, orgId))
  })

  it('enqueues a pending row inside the caller transaction, defaulting kind and idempotencyKey', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)

    await db.transaction((tx: Tx) =>
      enqueueOutboundDelivery(tx, { messageId, payload: { to: 'customer@example.com', subject: 'Hi' } })
    )

    const [row] = await db
      .select()
      .from(supportOutboundDelivery)
      .where(eq(supportOutboundDelivery.messageId, messageId))
    expect(row.status).toBe('pending')
    expect(row.kind).toBe('email')
    expect(row.idempotencyKey).toBeTruthy()
    expect(row.attemptCount).toBe(0)

    // Clean up so this does not linger as 'pending' and get claimed ahead of
    // a later test's own row (see the same note on the next test).
    await db.delete(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, row.id))
  })

  it('rejects a second enqueue for the same message and kind', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)
    const payload = { to: 'customer@example.com', subject: 'Hi' }

    await db.transaction((tx: Tx) => enqueueOutboundDelivery(tx, { messageId, payload }))

    await expect(db.transaction((tx: Tx) => enqueueOutboundDelivery(tx, { messageId, payload }))).rejects.toThrow()

    // Clean up so this does not linger as 'pending' and get claimed ahead of
    // a later test's own row - claimNextOutboundDelivery takes the oldest
    // pending row across the whole table, unscoped to a test.
    const [row] = await db
      .select()
      .from(supportOutboundDelivery)
      .where(eq(supportOutboundDelivery.messageId, messageId))
    await db.delete(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, row.id))
  })

  it('claims the oldest pending row and marks it leased', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)
    await db.transaction((tx: Tx) =>
      enqueueOutboundDelivery(tx, { messageId, payload: { to: 'customer@example.com', subject: 'Claim me' } })
    )

    const claim = await claimNextOutboundDelivery()

    expect(claim).not.toBeNull()
    expect(claim?.messageId).toBe(messageId)
    expect(claim?.attemptCount).toBe(1)

    const [row] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, claim!.id))
    expect(row.leaseExpiresAt).not.toBeNull()
    expect(row.attemptCount).toBe(1)

    // Clean up so it does not linger as 'pending' and get claimed by an
    // unrelated later test.
    await completeOutboundDelivery(claim!.id, messageId, claim!.attemptCount)
  })

  it('does not reclaim a row whose lease is still live', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)
    await db.transaction((tx: Tx) =>
      enqueueOutboundDelivery(tx, { messageId, payload: { to: 'customer@example.com', subject: 'Leased' } })
    )

    const first = await claimNextOutboundDelivery()
    expect(first?.messageId).toBe(messageId)

    // A second claim must not pick up the same row while its lease is live -
    // it should either return null or claim a different, unrelated row, but
    // never this one again.
    const second = await claimNextOutboundDelivery()
    expect(second?.id).not.toBe(first?.id)

    await completeOutboundDelivery(first!.id, first!.messageId, first!.attemptCount)
    if (second) await completeOutboundDelivery(second.id, second.messageId, second.attemptCount)
  })

  it('gives only one of two concurrent workers the same pending row', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)
    await db.transaction((tx: Tx) =>
      enqueueOutboundDelivery(tx, { messageId, payload: { to: 'customer@example.com', subject: 'Race' } })
    )

    const claims = await Promise.all([claimNextOutboundDelivery(), claimNextOutboundDelivery()])
    const owners = claims.filter((claim) => claim?.messageId === messageId)
    expect(owners).toHaveLength(1)
    await completeOutboundDelivery(owners[0]!.id, messageId, owners[0]!.attemptCount)
    for (const claim of claims) {
      if (claim && claim.messageId !== messageId) {
        await completeOutboundDelivery(claim.id, claim.messageId, claim.attemptCount)
      }
    }
  })

  it('prevents stale completion and failure from mutating a newer claimed attempt', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)
    await db.transaction((tx: Tx) =>
      enqueueOutboundDelivery(tx, { messageId, payload: { to: 'customer@example.com', subject: 'Reclaim' } })
    )
    const first = await claimNextOutboundDelivery()
    await db
      .update(supportOutboundDelivery)
      .set({ leaseExpiresAt: new Date(Date.now() - 1) })
      .where(eq(supportOutboundDelivery.id, first!.id))
    const second = await claimNextOutboundDelivery()
    expect(second?.id).toBe(first?.id)
    expect(second?.attemptCount).toBe(2)

    expect(await completeOutboundDelivery(first!.id, messageId, first!.attemptCount)).toBe(false)
    expect(await failOutboundDelivery(first!.id, messageId, new Error('stale'), first!.attemptCount)).toBe(false)
    expect(await completeOutboundDelivery(second!.id, messageId, second!.attemptCount)).toBe(true)
  })

  it('processes a retryable failure at most once in one worker pass', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)
    await db.transaction((tx: Tx) =>
      enqueueOutboundDelivery(tx, { messageId, payload: { to: 'customer@example.com', subject: 'One pass' } })
    )
    let processed = 0
    const result = await runOutboundDeliveryWorker({
      process: async (claim) => {
        processed += 1
        await failOutboundDelivery(claim.id, claim.messageId, new Error('retry'), claim.attemptCount, {
          now: new Date(),
          random: () => 0.5,
        })
        return { outcome: 'failed', error: 'retry' }
      },
    })
    expect(result.processed).toBe(1)
    expect(processed).toBe(1)
    const [row] = await db
      .select()
      .from(supportOutboundDelivery)
      .where(eq(supportOutboundDelivery.messageId, messageId))
    expect(row.status).toBe('pending')
    expect(row.nextAttemptAt).not.toBeNull()
    await db.delete(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, row.id))
  })

  it('completeOutboundDelivery marks the row sent, clears the lease, and syncs conversationMessage.deliveryStatus', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)
    await db.transaction((tx: Tx) =>
      enqueueOutboundDelivery(tx, { messageId, payload: { to: 'customer@example.com', subject: 'Complete me' } })
    )
    const claim = await claimNextOutboundDelivery()

    await completeOutboundDelivery(claim!.id, messageId, claim!.attemptCount)

    const [row] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, claim!.id))
    expect(row.status).toBe('sent')
    expect(row.leaseExpiresAt).toBeNull()

    const [message] = await db.select().from(conversationMessage).where(eq(conversationMessage.id, messageId))
    expect(message.deliveryStatus).toBe('sent')
    expect(message.deliveryError).toBeNull()
  })

  it('failOutboundDelivery below the attempt cap stays pending but is not reclaimable before its due time', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)
    await db.transaction((tx: Tx) =>
      enqueueOutboundDelivery(tx, { messageId, payload: { to: 'customer@example.com', subject: 'Retry me' } })
    )
    const claim = await claimNextOutboundDelivery()

    const failedAt = new Date('2026-08-20T10:00:00Z')
    await failOutboundDelivery(claim!.id, messageId, new Error('SMTP timeout'), claim!.attemptCount, {
      now: failedAt,
      random: () => 0.5,
    })

    const [row] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, claim!.id))
    expect(row.status).toBe('pending')
    expect(row.leaseExpiresAt).toBeNull()
    expect(row.lastError).toBe('SMTP timeout')
    expect(row.nextAttemptAt).toEqual(new Date('2026-08-20T10:01:00Z'))

    // Not yet visible to the agent as "failed" - it will auto-retry.
    const [message] = await db.select().from(conversationMessage).where(eq(conversationMessage.id, messageId))
    expect(message.deliveryStatus).toBe('pending')

    expect(await claimNextOutboundDelivery({ now: new Date('2026-08-20T10:00:59.999Z') })).toBeNull()
    const reclaimed = await claimNextOutboundDelivery({ now: new Date('2026-08-20T10:01:00Z') })
    expect(reclaimed?.id).toBe(claim!.id)
    await completeOutboundDelivery(reclaimed!.id, messageId, reclaimed!.attemptCount)
  })

  it('failOutboundDelivery at the attempt cap becomes terminal and marks conversationMessage.deliveryStatus failed', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)
    await db.transaction((tx: Tx) =>
      enqueueOutboundDelivery(tx, { messageId, payload: { to: 'customer@example.com', subject: 'Give up' } })
    )
    const claim = await claimNextOutboundDelivery()
    await db
      .update(supportOutboundDelivery)
      .set({ attemptCount: MAX_DELIVERY_ATTEMPTS })
      .where(eq(supportOutboundDelivery.id, claim!.id))

    expect(
      await failOutboundDelivery(claim!.id, messageId, new Error('Permanent rejection'), MAX_DELIVERY_ATTEMPTS)
    ).toBe(true)

    const [row] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, claim!.id))
    expect(row.status).toBe('failed')

    const [message] = await db.select().from(conversationMessage).where(eq(conversationMessage.id, messageId))
    expect(message.deliveryStatus).toBe('failed')
    expect(message.deliveryError).toBe('Permanent rejection')

    // Terminal - never claimed again.
    const reclaimed = await claimNextOutboundDelivery()
    expect(reclaimed?.id).not.toBe(claim!.id)
    if (reclaimed) await completeOutboundDelivery(reclaimed.id, reclaimed.messageId, reclaimed.attemptCount)
  })

  it('resetOutboundDeliveryForRetry brings a terminal failure back to pending, claimable again, and resets conversationMessage.deliveryStatus', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)
    await db.transaction((tx: Tx) =>
      enqueueOutboundDelivery(tx, { messageId, payload: { to: 'customer@example.com', subject: 'Manual retry' } })
    )
    const claim = await claimNextOutboundDelivery()
    const stableIdempotencyKey = claim!.idempotencyKey
    await db
      .update(conversationMessage)
      .set({ channelMessageId: 'stable-rfc-id@example.com' })
      .where(eq(conversationMessage.id, messageId))
    await db
      .update(supportOutboundDelivery)
      .set({ attemptCount: MAX_DELIVERY_ATTEMPTS })
      .where(eq(supportOutboundDelivery.id, claim!.id))
    await failOutboundDelivery(claim!.id, messageId, new Error('Permanent rejection'), MAX_DELIVERY_ATTEMPTS)

    // Confirm it is actually terminal first - otherwise the next assertion
    // proves nothing about the reset itself.
    const [failedRow] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, claim!.id))
    expect(failedRow.status).toBe('failed')

    expect(await resetOutboundDeliveryForRetry(claim!.id, messageId)).toBe(true)
    expect(await resetOutboundDeliveryForRetry(claim!.id, messageId)).toBe(false)

    const [resetRow] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, claim!.id))
    expect(resetRow.status).toBe('pending')
    expect(resetRow.attemptCount).toBe(0)
    expect(resetRow.lastError).toBeNull()
    expect(resetRow.nextAttemptAt).not.toBeNull()
    expect(resetRow.idempotencyKey).toBe(stableIdempotencyKey)

    const [message] = await db.select().from(conversationMessage).where(eq(conversationMessage.id, messageId))
    expect(message.deliveryStatus).toBe('pending')
    expect(message.deliveryError).toBeNull()
    expect(message.channelMessageId).toBe('stable-rfc-id@example.com')

    const reclaimed = await claimNextOutboundDelivery()
    expect(reclaimed?.id).toBe(claim!.id)
    await completeOutboundDelivery(reclaimed!.id, messageId, reclaimed!.attemptCount)
  })

  it('delivers a legacy queued payload and derives provider diagnostics without rewriting it', async () => {
    const messageId = newMessage()
    const deliveryId = `delivery_legacy_${randomUUID()}`
    const storageKey = `support/${randomUUID()}/legacy.txt`
    const idempotencyKey = `legacy-key-${randomUUID()}`
    const legacyPayload = {
      to: 'customer@example.com',
      subject: 'Legacy queued reply',
      text: 'Still deliver me',
      attachments: [{ filename: 'legacy.txt', storageKey }],
    }
    await insertMessage(messageId)
    await db.insert(conversationAttachment).values({
      id: `attachment_${randomUUID()}`,
      messageId,
      storageKey,
      fileName: 'legacy.txt',
      sizeBytes: 12,
      createdAt: now,
    })
    await db.insert(supportOutboundDelivery).values({
      id: deliveryId,
      messageId,
      kind: 'email',
      payload: legacyPayload,
      idempotencyKey,
      provider: null,
      providerAccountKey: null,
      providerMessageId: null,
      createdAt: now,
      updatedAt: now,
    })

    const previousProvider = process.env.SUPPORT_CHANNEL_PROVIDER
    const previousAccount = process.env.SUPPORT_POSTMARK_ACCOUNT_KEY
    process.env.SUPPORT_CHANNEL_PROVIDER = 'postmark'
    process.env.SUPPORT_POSTMARK_ACCOUNT_KEY = 'legacy-server'
    try {
      const claim = await claimNextOutboundDelivery()
      expect(claim?.id).toBe(deliveryId)
      expect(claim?.idempotencyKey).toBe(idempotencyKey)
      expect(claim?.provider).toBe('postmark')
      expect(claim?.providerAccountKey).toBe('legacy-server')

      const sendEmail = async () => ({ accepted: true, response: 'accepted', providerMessageId: 'provider-legacy-1' })
      const result = await processOutboundDelivery(claim!, {
        sendEmail,
        getObject: async (key) => {
          expect(key).toBe(storageKey)
          return Buffer.from('legacy bytes')
        },
      })
      expect(result).toEqual({ outcome: 'sent' })

      const [stored] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, deliveryId))
      expect(stored.payload).toEqual(legacyPayload)
      expect(stored.provider).toBe('postmark')
      expect(stored.providerAccountKey).toBe('legacy-server')
      expect(stored.providerMessageId).toBe('provider-legacy-1')
      expect(stored.status).toBe('sent')
    } finally {
      if (previousProvider === undefined) delete process.env.SUPPORT_CHANNEL_PROVIDER
      else process.env.SUPPORT_CHANNEL_PROVIDER = previousProvider
      if (previousAccount === undefined) delete process.env.SUPPORT_POSTMARK_ACCOUNT_KEY
      else process.env.SUPPORT_POSTMARK_ACCOUNT_KEY = previousAccount
    }
  })

  it('recovers a delivery abandoned on its final attempt instead of stranding it', async () => {
    // A worker killed mid-send on the last attempt: the claim already
    // incremented attemptCount to the cap, so the row stays `pending` at 5 with
    // a lease that lapses. `attempt_count < MAX` is now false, so no worker can
    // reclaim it, and the manual retry endpoint requires `failed`. Before the
    // reaper this was recoverable only by hand-written SQL.
    const messageId = newMessage()
    await insertMessage(messageId)
    const deliveryId = randomUUID()
    const lapsed = new Date(Date.now() - 60_000)
    await db.insert(supportOutboundDelivery).values({
      id: deliveryId,
      messageId,
      kind: 'email',
      payload: { to: 'customer@example.com', subject: 'Abandoned' },
      idempotencyKey: deliveryId,
      status: 'pending',
      attemptCount: MAX_DELIVERY_ATTEMPTS,
      leaseExpiresAt: lapsed,
      createdAt: now,
      updatedAt: now,
    })
    await db.update(conversationMessage).set({ deliveryStatus: 'pending' }).where(eq(conversationMessage.id, messageId))

    // Confirm the row really is unreachable by the ordinary claim path first,
    // so this test fails loudly if the claim predicate ever changes.
    const unreachable = await claimNextOutboundDelivery()
    expect(unreachable?.id).not.toBe(deliveryId)

    expect(await reapAbandonedOutboundDeliveries()).toBeGreaterThanOrEqual(1)

    const [settled] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, deliveryId))
    expect(settled.status).toBe('failed')
    expect(settled.leaseExpiresAt).toBeNull()

    const [message] = await db
      .select({ deliveryStatus: conversationMessage.deliveryStatus })
      .from(conversationMessage)
      .where(eq(conversationMessage.id, messageId))
    // `failed` is what makes the agent-facing retry action legal again.
    expect(message.deliveryStatus).toBe('failed')

    expect(await resetOutboundDeliveryForRetry(deliveryId, messageId)).toBe(true)
  })

  it('leaves a still-leased final attempt alone', async () => {
    // The worker may simply still be running. Reaping on attempt count alone
    // would settle a live send as failed and invite a duplicate.
    const messageId = newMessage()
    await insertMessage(messageId)
    const deliveryId = randomUUID()
    await db.insert(supportOutboundDelivery).values({
      id: deliveryId,
      messageId,
      kind: 'email',
      payload: { to: 'customer@example.com', subject: 'In flight' },
      idempotencyKey: deliveryId,
      status: 'pending',
      attemptCount: MAX_DELIVERY_ATTEMPTS,
      leaseExpiresAt: new Date(Date.now() + 300_000),
      createdAt: now,
      updatedAt: now,
    })

    await reapAbandonedOutboundDeliveries()

    const [stored] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, deliveryId))
    expect(stored.status).toBe('pending')
  })
})
