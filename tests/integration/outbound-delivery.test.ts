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
  resetOutboundDeliveryForRetry,
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
    await completeOutboundDelivery(row.id, messageId)
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
    const [row] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.messageId, messageId))
    await completeOutboundDelivery(row.id, messageId)
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
    await completeOutboundDelivery(claim!.id, messageId)
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

    await completeOutboundDelivery(first!.id, first!.messageId)
    if (second) await completeOutboundDelivery(second.id, second.messageId)
  })

  it('completeOutboundDelivery marks the row sent, clears the lease, and syncs conversationMessage.deliveryStatus', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)
    await db.transaction((tx: Tx) =>
      enqueueOutboundDelivery(tx, { messageId, payload: { to: 'customer@example.com', subject: 'Complete me' } })
    )
    const claim = await claimNextOutboundDelivery()

    await completeOutboundDelivery(claim!.id, messageId)

    const [row] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, claim!.id))
    expect(row.status).toBe('sent')
    expect(row.leaseExpiresAt).toBeNull()

    const [message] = await db.select().from(conversationMessage).where(eq(conversationMessage.id, messageId))
    expect(message.deliveryStatus).toBe('sent')
    expect(message.deliveryError).toBeNull()
  })

  it('failOutboundDelivery below the attempt cap stays pending and reclaimable, and leaves conversationMessage.deliveryStatus at pending', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)
    await db.transaction((tx: Tx) =>
      enqueueOutboundDelivery(tx, { messageId, payload: { to: 'customer@example.com', subject: 'Retry me' } })
    )
    const claim = await claimNextOutboundDelivery()

    await failOutboundDelivery(claim!.id, messageId, new Error('SMTP timeout'), claim!.attemptCount)

    const [row] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, claim!.id))
    expect(row.status).toBe('pending')
    expect(row.leaseExpiresAt).toBeNull()
    expect(row.lastError).toBe('SMTP timeout')

    // Not yet visible to the agent as "failed" - it will auto-retry.
    const [message] = await db.select().from(conversationMessage).where(eq(conversationMessage.id, messageId))
    expect(message.deliveryStatus).toBe('pending')

    // Reclaimable immediately since the lease was cleared.
    const reclaimed = await claimNextOutboundDelivery()
    expect(reclaimed?.id).toBe(claim!.id)
    await completeOutboundDelivery(reclaimed!.id, messageId)
  })

  it('failOutboundDelivery at the attempt cap becomes terminal and marks conversationMessage.deliveryStatus failed', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)
    await db.transaction((tx: Tx) =>
      enqueueOutboundDelivery(tx, { messageId, payload: { to: 'customer@example.com', subject: 'Give up' } })
    )
    const claim = await claimNextOutboundDelivery()

    await failOutboundDelivery(claim!.id, messageId, new Error('Permanent rejection'), MAX_DELIVERY_ATTEMPTS)

    const [row] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, claim!.id))
    expect(row.status).toBe('failed')

    const [message] = await db.select().from(conversationMessage).where(eq(conversationMessage.id, messageId))
    expect(message.deliveryStatus).toBe('failed')
    expect(message.deliveryError).toBe('Permanent rejection')

    // Terminal - never claimed again.
    const reclaimed = await claimNextOutboundDelivery()
    expect(reclaimed?.id).not.toBe(claim!.id)
    if (reclaimed) await completeOutboundDelivery(reclaimed.id, reclaimed.messageId)
  })

  it('resetOutboundDeliveryForRetry brings a terminal failure back to pending, claimable again, and resets conversationMessage.deliveryStatus', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)
    await db.transaction((tx: Tx) =>
      enqueueOutboundDelivery(tx, { messageId, payload: { to: 'customer@example.com', subject: 'Manual retry' } })
    )
    const claim = await claimNextOutboundDelivery()
    await failOutboundDelivery(claim!.id, messageId, new Error('Permanent rejection'), MAX_DELIVERY_ATTEMPTS)

    // Confirm it is actually terminal first - otherwise the next assertion
    // proves nothing about the reset itself.
    const [failedRow] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, claim!.id))
    expect(failedRow.status).toBe('failed')

    await resetOutboundDeliveryForRetry(claim!.id, messageId)

    const [resetRow] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, claim!.id))
    expect(resetRow.status).toBe('pending')
    expect(resetRow.attemptCount).toBe(0)
    expect(resetRow.lastError).toBeNull()

    const [message] = await db.select().from(conversationMessage).where(eq(conversationMessage.id, messageId))
    expect(message.deliveryStatus).toBe('pending')
    expect(message.deliveryError).toBeNull()

    const reclaimed = await claimNextOutboundDelivery()
    expect(reclaimed?.id).toBe(claim!.id)
    await completeOutboundDelivery(reclaimed!.id, messageId)
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

      const [stored] = await db
        .select()
        .from(supportOutboundDelivery)
        .where(eq(supportOutboundDelivery.id, deliveryId))
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
})
