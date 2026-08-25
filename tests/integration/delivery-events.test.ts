import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, team } from '../../server/database/schema/auth'
import {
  contact,
  conversation,
  conversationMessage,
  supportDeliveryEvent,
  supportInbox,
} from '../../server/database/schema/support'
import {
  claimDeliveryEvent,
  completeDeliveryEvent,
  failDeliveryEvent,
  type DeliveryEventClaimOutcome,
} from '../../server/utils/delivery-events'
import { markDeliveryMessageBounced, markDeliveryMessageDelivered } from '../../server/utils/delivery-status'

/**
 * The claim is an atomic conditional upsert, mirroring `claimInboundEvent` -
 * a fake transaction cannot exercise what Postgres does under it. Guarded
 * like the other integration suites: skips cleanly when no database is
 * reachable.
 */

const PROVIDER = 'test-provider'
const created: string[] = []

function eventId() {
  const id = `dev_${randomUUID()}`
  created.push(id)
  return id
}

function claimed(claim: DeliveryEventClaimOutcome) {
  if (claim.outcome !== 'claimed') throw new Error(`Expected claimed event, got ${claim.outcome}`)
  return claim
}

// `supportDeliveryEvent.messageId` is a real FK to `conversationMessage.id` -
// the one test that sets it needs a real row, not an arbitrary string, or a
// real Postgres run would fail on the constraint rather than the assertion.
const orgId = `org_delivery_${randomUUID()}`
const teamId = `team_delivery_${randomUUID()}`
const inboxId = `inbox_delivery_${randomUUID()}`
const contactId = `contact_delivery_${randomUUID()}`
const conversationId = `conv_delivery_${randomUUID()}`
const fixtureMessageId = `msg_delivery_${randomUUID()}`
const now = new Date()

beforeAll(async () => {
  await db.insert(organization).values({ id: orgId, name: 'Delivery Org', slug: `delivery-org-${randomUUID()}` })
  await db
    .insert(team)
    .values({ id: teamId, name: 'Delivery Team', slug: `delivery-team-${randomUUID()}`, organizationId: orgId })
  await db.insert(supportInbox).values({
    id: inboxId,
    teamId,
    name: 'Delivery Inbox',
    slug: `delivery-inbox-${randomUUID()}`,
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
    displayId: 9201,
    subject: 'Delivery test',
    status: 'open',
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(conversationMessage).values({
    id: fixtureMessageId,
    conversationId,
    kind: 'outgoing',
    body: 'Reply body',
    senderKind: 'agent',
    createdAt: now,
  })
})

afterAll(async () => {
  // organization → team → inbox/contact/conversation → messages cascade.
  // supportDeliveryEvent.messageId is `onDelete: 'set null'`, not cascade, so
  // rows created against fixtureMessageId are cleaned up explicitly below
  // rather than relying on this delete to remove them.
  await db.delete(organization).where(eq(organization.id, orgId))
})

afterEach(async () => {
  for (const providerEventId of created.splice(0)) {
    await db
      .delete(supportDeliveryEvent)
      .where(
        and(eq(supportDeliveryEvent.provider, PROVIDER), eq(supportDeliveryEvent.providerEventId, providerEventId))
      )
  }
})

async function readEvent(providerEventId: string) {
  const [row] = await db
    .select()
    .from(supportDeliveryEvent)
    .where(and(eq(supportDeliveryEvent.provider, PROVIDER), eq(supportDeliveryEvent.providerEventId, providerEventId)))
    .limit(1)
  return row
}

describe('claimDeliveryEvent', () => {
  it('claims an unseen event, with all fields already known at claim time', async () => {
    const providerEventId = eventId()
    const claim = await claimDeliveryEvent({
      provider: PROVIDER,
      providerEventId,
      recordType: 'delivered',
      recipient: 'customer@example.com',
      messageId: null,
    })

    expect(claim.outcome).toBe('claimed')
    const row = await readEvent(providerEventId)
    expect(row.status).toBe('processing')
    expect(row.recordType).toBe('delivered')
    expect(row.recipient).toBe('customer@example.com')
    expect(row.messageId).toBeNull()
  })

  it('reports a retry as duplicate once the event has been completed', async () => {
    const providerEventId = eventId()
    const first = claimed(
      await claimDeliveryEvent({
        provider: PROVIDER,
        providerEventId,
        recordType: 'delivered',
        recipient: 'customer@example.com',
        messageId: null,
      })
    )
    await completeDeliveryEvent(first.eventId, first.attemptCount)

    const retry = await claimDeliveryEvent({
      provider: PROVIDER,
      providerEventId,
      recordType: 'delivered',
      recipient: 'customer@example.com',
      messageId: null,
    })

    expect(retry.outcome).toBe('duplicate')
  })

  it('reports a retry as in-progress while the lease is live', async () => {
    const providerEventId = eventId()
    await claimDeliveryEvent({
      provider: PROVIDER,
      providerEventId,
      recordType: 'bounced',
      recipient: 'customer@example.com',
      messageId: null,
    })

    const retry = await claimDeliveryEvent({
      provider: PROVIDER,
      providerEventId,
      recordType: 'bounced',
      recipient: 'customer@example.com',
      messageId: null,
    })

    expect(retry.outcome).toBe('in-progress')
  })

  it('reclaims a failed event whose lease has cleared', async () => {
    const providerEventId = eventId()
    const first = claimed(
      await claimDeliveryEvent({
        provider: PROVIDER,
        providerEventId,
        recordType: 'bounced',
        recipient: 'customer@example.com',
        messageId: null,
      })
    )
    await failDeliveryEvent(first.eventId, first.attemptCount, new Error('db unreachable'))

    const retry = await claimDeliveryEvent({
      provider: PROVIDER,
      providerEventId,
      recordType: 'bounced',
      recipient: 'customer@example.com',
      messageId: null,
    })

    expect(retry.outcome).toBe('claimed')
    expect((await readEvent(providerEventId)).attemptCount).toBe(2)
  })

  it('completeDeliveryEvent marks the row processed with the resolved messageId', async () => {
    const providerEventId = eventId()
    const claim = claimed(
      await claimDeliveryEvent({
        provider: PROVIDER,
        providerEventId,
        recordType: 'delivered',
        recipient: 'customer@example.com',
        messageId: fixtureMessageId,
      })
    )

    await completeDeliveryEvent(claim.eventId, claim.attemptCount)

    const row = await readEvent(providerEventId)
    expect(row.status).toBe('processed')
    expect(row.processedAt).not.toBeNull()
    expect(row.messageId).toBe(fixtureMessageId)
  })

  it('does not let a stale claim finalize a reclaimed attempt', async () => {
    const providerEventId = eventId()
    const first = claimed(
      await claimDeliveryEvent({
        provider: PROVIDER,
        providerEventId,
        recordType: 'delivered',
        recipient: 'customer@example.com',
        messageId: fixtureMessageId,
      })
    )

    await db
      .update(supportDeliveryEvent)
      .set({ leaseExpiresAt: new Date(Date.now() - 1) })
      .where(eq(supportDeliveryEvent.id, first.eventId))

    const second = claimed(
      await claimDeliveryEvent({
        provider: PROVIDER,
        providerEventId,
        recordType: 'delivered',
        recipient: 'customer@example.com',
        messageId: fixtureMessageId,
      })
    )
    expect(second.outcome).toBe('claimed')

    await expect(completeDeliveryEvent(first.eventId, first.attemptCount)).rejects.toThrow(/ownership/i)
    expect(await failDeliveryEvent(first.eventId, first.attemptCount, new Error('stale'))).toBe(false)

    const row = await readEvent(providerEventId)
    expect(row.status).toBe('processing')
    expect(row.attemptCount).toBe(2)

    await completeDeliveryEvent(second.eventId, second.attemptCount)
  })
})

describe('delivery message status transitions', () => {
  async function setMessageStatus(status: string) {
    await db
      .update(conversationMessage)
      .set({ deliveryStatus: status })
      .where(eq(conversationMessage.id, fixtureMessageId))
  }

  it.each(['sent', 'failed'])('promotes %s to delivered atomically', async (status) => {
    await setMessageStatus(status)

    const updated = await markDeliveryMessageDelivered(db, fixtureMessageId)

    expect(updated).toBe(true)
    const [row] = await db
      .select({ deliveryStatus: conversationMessage.deliveryStatus })
      .from(conversationMessage)
      .where(eq(conversationMessage.id, fixtureMessageId))
    expect(row.deliveryStatus).toBe('delivered')
  })

  it('does not promote a bounced message when a delivered event arrives', async () => {
    await setMessageStatus('bounced')

    expect(await markDeliveryMessageDelivered(db, fixtureMessageId)).toBe(false)
    const [row] = await db
      .select({ deliveryStatus: conversationMessage.deliveryStatus })
      .from(conversationMessage)
      .where(eq(conversationMessage.id, fixtureMessageId))
    expect(row.deliveryStatus).toBe('bounced')
  })

  it('keeps bounce terminal regardless of event ordering', async () => {
    await setMessageStatus('delivered')
    expect(await markDeliveryMessageBounced(db, fixtureMessageId, 'hard bounce')).toBe(true)
    expect(await markDeliveryMessageDelivered(db, fixtureMessageId)).toBe(false)

    const [row] = await db
      .select({ deliveryStatus: conversationMessage.deliveryStatus })
      .from(conversationMessage)
      .where(eq(conversationMessage.id, fixtureMessageId))
    expect(row.deliveryStatus).toBe('bounced')
  })
})
