import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, team } from '../../server/database/schema/auth'
import {
  contact,
  conversation,
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
  })

  it('rejects a second enqueue for the same message and kind', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)
    const payload = { to: 'customer@example.com', subject: 'Hi' }

    await db.transaction((tx: Tx) => enqueueOutboundDelivery(tx, { messageId, payload }))

    await expect(db.transaction((tx: Tx) => enqueueOutboundDelivery(tx, { messageId, payload }))).rejects.toThrow()
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
    await completeOutboundDelivery(claim!.id)
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

    await completeOutboundDelivery(first!.id)
    if (second) await completeOutboundDelivery(second.id)
  })

  it('completeOutboundDelivery marks the row sent and clears the lease', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)
    await db.transaction((tx: Tx) =>
      enqueueOutboundDelivery(tx, { messageId, payload: { to: 'customer@example.com', subject: 'Complete me' } })
    )
    const claim = await claimNextOutboundDelivery()

    await completeOutboundDelivery(claim!.id)

    const [row] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, claim!.id))
    expect(row.status).toBe('sent')
    expect(row.leaseExpiresAt).toBeNull()
  })

  it('failOutboundDelivery below the attempt cap stays pending and reclaimable', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)
    await db.transaction((tx: Tx) =>
      enqueueOutboundDelivery(tx, { messageId, payload: { to: 'customer@example.com', subject: 'Retry me' } })
    )
    const claim = await claimNextOutboundDelivery()

    await failOutboundDelivery(claim!.id, new Error('SMTP timeout'), claim!.attemptCount)

    const [row] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, claim!.id))
    expect(row.status).toBe('pending')
    expect(row.leaseExpiresAt).toBeNull()
    expect(row.lastError).toBe('SMTP timeout')

    // Reclaimable immediately since the lease was cleared.
    const reclaimed = await claimNextOutboundDelivery()
    expect(reclaimed?.id).toBe(claim!.id)
    await completeOutboundDelivery(reclaimed!.id)
  })

  it('failOutboundDelivery at the attempt cap becomes terminal', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)
    await db.transaction((tx: Tx) =>
      enqueueOutboundDelivery(tx, { messageId, payload: { to: 'customer@example.com', subject: 'Give up' } })
    )
    const claim = await claimNextOutboundDelivery()

    await failOutboundDelivery(claim!.id, new Error('Permanent rejection'), MAX_DELIVERY_ATTEMPTS)

    const [row] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, claim!.id))
    expect(row.status).toBe('failed')

    // Terminal - never claimed again.
    const reclaimed = await claimNextOutboundDelivery()
    expect(reclaimed?.id).not.toBe(claim!.id)
    if (reclaimed) await completeOutboundDelivery(reclaimed.id)
  })

  it('resetOutboundDeliveryForRetry brings a terminal failure back to pending, claimable again', async () => {
    const messageId = newMessage()
    await insertMessage(messageId)
    await db.transaction((tx: Tx) =>
      enqueueOutboundDelivery(tx, { messageId, payload: { to: 'customer@example.com', subject: 'Manual retry' } })
    )
    const claim = await claimNextOutboundDelivery()
    await failOutboundDelivery(claim!.id, new Error('Permanent rejection'), MAX_DELIVERY_ATTEMPTS)

    // Confirm it is actually terminal first - otherwise the next assertion
    // proves nothing about the reset itself.
    const [failedRow] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, claim!.id))
    expect(failedRow.status).toBe('failed')

    await resetOutboundDeliveryForRetry(claim!.id)

    const [resetRow] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, claim!.id))
    expect(resetRow.status).toBe('pending')
    expect(resetRow.attemptCount).toBe(0)
    expect(resetRow.lastError).toBeNull()

    const reclaimed = await claimNextOutboundDelivery()
    expect(reclaimed?.id).toBe(claim!.id)
    await completeOutboundDelivery(reclaimed!.id)
  })
})
