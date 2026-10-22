import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../server/database/drizzle'
import {
  conversation,
  conversationMessage,
  csatResponse,
  csatSurvey,
  supportInbox,
  supportOutboundDelivery,
  supportSendingDomain,
} from '../../server/database/schema/support'
import {
  deleteOrganization,
  seedOrganization,
  seedQueuedDelivery,
  seedSendingDomain,
  seedTeamWithInbox,
  type SeededTeam,
} from './helpers/sender-seed'

/**
 * Enforcement points of the team sender policy (design §4.5) against real
 * Postgres: the outbox final check, `failOutboundDelivery`'s terminal option,
 * and CSAT. The provider (WP2) is mocked; `server/utils/sending-domains` (WP1)
 * is REAL, so the "team policy" describe block only runs once WP1 is merged.
 *
 * Teams: A verified `acme.com`; B has no claim; C only a pending claim.
 */

const provider = vi.hoisted(() => ({
  current: {
    name: 'mailgun',
    accountKey: 'acct',
    capabilities: { authorizesSubdomains: true },
  } as null | Record<string, unknown>,
}))
vi.mock('../../server/services/sending-domains', () => ({ getSendingDomainProvider: () => provider.current }))

const { failOutboundDelivery, processOutboundDelivery } = await import('../../server/utils/outbound-delivery')
const { runCsatDispatchSweep } = await import('../../server/utils/csat')
const { ensurePlatformAddress } = await import('../../server/utils/platform-address')

let orgId: string
let teamA: SeededTeam
let teamB: SeededTeam
let teamC: SeededTeam
let domainA: string

beforeAll(async () => {
  orgId = await seedOrganization('enforce')
  teamA = await seedTeamWithInbox(orgId, 'enfa', 'support-a@acme.test')
  teamB = await seedTeamWithInbox(orgId, 'enfb', 'support-b@other.test')
  teamC = await seedTeamWithInbox(orgId, 'enfc', 'support@pending.test')
})

afterAll(async () => {
  await deleteOrganization(orgId)
})

beforeEach(() => {
  vi.unstubAllEnvs()
})

async function deliveryRow(deliveryId: string) {
  const [row] = await db.select().from(supportOutboundDelivery).where(eq(supportOutboundDelivery.id, deliveryId))
  return row
}

async function messageRow(messageId: string) {
  const [row] = await db.select().from(conversationMessage).where(eq(conversationMessage.id, messageId))
  return row
}

describe('failOutboundDelivery terminal option', () => {
  it('fails a first attempt permanently when terminal is set', async () => {
    const queued = await seedQueuedDelivery(teamA, 'support@acme.test')

    const failed = await failOutboundDelivery(queued.deliveryId, queued.messageId, 'SENDER_DOMAIN_NOT_AUTHORIZED', 1, {
      terminal: true,
    })

    expect(failed).toBe(true)
    expect(await deliveryRow(queued.deliveryId)).toMatchObject({
      status: 'failed',
      nextAttemptAt: null,
      lastError: 'SENDER_DOMAIN_NOT_AUTHORIZED',
    })
    expect(await messageRow(queued.messageId)).toMatchObject({
      deliveryStatus: 'failed',
      deliveryError: 'SENDER_DOMAIN_NOT_AUTHORIZED',
    })
  })

  it('keeps retrying a first attempt without the option', async () => {
    const queued = await seedQueuedDelivery(teamA, 'support@acme.test')

    await failOutboundDelivery(queued.deliveryId, queued.messageId, new Error('socket hang up'), 1)

    const row = await deliveryRow(queued.deliveryId)
    expect(row?.status).toBe('pending')
    expect(row?.nextAttemptAt).toBeInstanceOf(Date)
  })

  it('processOutboundDelivery fails terminally through the real failure path when the sender is refused', async () => {
    const queued = await seedQueuedDelivery(teamB, 'support@acme.test')
    const sendEmail = vi.fn()

    const result = await processOutboundDelivery(queued.claim, {
      sendEmail,
      getObject: vi.fn(),
      authorizeSender: async () => false,
    })

    expect(result).toEqual({ outcome: 'failed', error: 'SENDER_DOMAIN_NOT_AUTHORIZED' })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(await deliveryRow(queued.deliveryId)).toMatchObject({
      status: 'failed',
      lastError: 'SENDER_DOMAIN_NOT_AUTHORIZED',
    })
    expect((await messageRow(queued.messageId))?.deliveryStatus).toBe('failed')
  })
})

describe('legacy sender policy', () => {
  it('sends as any address, without consulting team claims', async () => {
    vi.stubEnv('SUPPORT_SENDER_POLICY', 'legacy')
    vi.stubEnv('SUPPORT_SENDING_DOMAINS_ENABLED', '')
    const queued = await seedQueuedDelivery(teamB, 'support@acme.test')
    const sendEmail = vi.fn().mockResolvedValue({ accepted: true, response: 'ok' })

    const result = await processOutboundDelivery(queued.claim, { sendEmail, getObject: vi.fn() })

    expect(result).toEqual({ outcome: 'sent' })
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })
})

describe('team sender policy (needs WP1)', () => {
  beforeAll(async () => {
    domainA = await seedSendingDomain({ teamId: teamA.teamId, domain: 'acme.test' })
    await seedSendingDomain({ teamId: teamC.teamId, domain: 'pending.test', status: 'pending' })
  })

  beforeEach(() => {
    vi.stubEnv('SUPPORT_SENDER_POLICY', 'team')
  })

  async function process(seed: SeededTeam, from: string) {
    const queued = await seedQueuedDelivery(seed, from)
    const sendEmail = vi.fn().mockResolvedValue({ accepted: true, response: 'ok' })
    const result = await processOutboundDelivery(queued.claim, { sendEmail, getObject: vi.fn() })
    return { result, sendEmail, queued }
  }

  it("blocks team B from sending as team A's verified domain, terminally and without calling sendEmail", async () => {
    const { result, sendEmail, queued } = await process(teamB, 'support@acme.test')

    expect(result).toEqual({ outcome: 'failed', error: 'SENDER_DOMAIN_NOT_AUTHORIZED' })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(await deliveryRow(queued.deliveryId)).toMatchObject({
      status: 'failed',
      lastError: 'SENDER_DOMAIN_NOT_AUTHORIZED',
    })
  })

  it('lets team A send as its own verified domain, including a subdomain on a subdomain-authorizing provider', async () => {
    expect((await process(teamA, 'support@acme.test')).result).toEqual({ outcome: 'sent' })
    expect((await process(teamA, 'help@eu.acme.test')).result).toEqual({ outcome: 'sent' })
  })

  it('refuses a subdomain when the provider only authorizes exact domains', async () => {
    provider.current = { name: 'mailgun', accountKey: 'acct', capabilities: { authorizesSubdomains: false } }
    try {
      expect((await process(teamA, 'help@eu.acme.test')).result).toMatchObject({ outcome: 'failed' })
      expect((await process(teamA, 'support@acme.test')).result).toEqual({ outcome: 'sent' })
    } finally {
      provider.current = { name: 'mailgun', accountKey: 'acct', capabilities: { authorizesSubdomains: true } }
    }
  })

  it('blocks a pending claim', async () => {
    const { result, sendEmail } = await process(teamC, 'support@pending.test')

    expect(result).toMatchObject({ outcome: 'failed', error: 'SENDER_DOMAIN_NOT_AUTHORIZED' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('suspension blocks queued mail and recovery unblocks a retry', async () => {
    await db.update(supportSendingDomain).set({ status: 'suspended' }).where(eq(supportSendingDomain.id, domainA))
    try {
      expect((await process(teamA, 'support@acme.test')).result).toMatchObject({
        outcome: 'failed',
        error: 'SENDER_DOMAIN_NOT_AUTHORIZED',
      })
    } finally {
      await db.update(supportSendingDomain).set({ status: 'verified' }).where(eq(supportSendingDomain.id, domainA))
    }

    expect((await process(teamA, 'support@acme.test')).result).toEqual({ outcome: 'sent' })
  })

  it('blocks a claim registered with a different provider account', async () => {
    await db
      .update(supportSendingDomain)
      .set({ providerAccountKey: 'other-project' })
      .where(eq(supportSendingDomain.id, domainA))
    try {
      expect((await process(teamA, 'support@acme.test')).result).toMatchObject({ outcome: 'failed' })
    } finally {
      await db
        .update(supportSendingDomain)
        .set({ providerAccountKey: 'acct' })
        .where(eq(supportSendingDomain.id, domainA))
    }
  })

  it("authorizes a team's own platform address and no one else's", async () => {
    vi.stubEnv('SUPPORT_PLATFORM_MAIL_DOMAIN', 'veerifymail.test')
    const platformA = await db.transaction((tx) =>
      ensurePlatformAddress(tx, { id: teamA.inboxId, slug: teamA.inboxSlug }, teamA.teamSlug)
    )

    expect((await process(teamA, platformA!.address)).result).toEqual({ outcome: 'sent' })
    expect((await process(teamB, platformA!.address)).result).toMatchObject({
      outcome: 'failed',
      error: 'SENDER_DOMAIN_NOT_AUTHORIZED',
    })
  })

  describe('CSAT', () => {
    async function seedSurveyFor(seed: SeededTeam) {
      const now = new Date()
      const surveyId = `csat_survey_${randomUUID()}`
      await db.insert(csatSurvey).values({
        id: surveyId,
        teamId: seed.teamId,
        inboxId: seed.inboxId,
        name: 'CSAT',
        scale: 'csat_5',
        question: 'How was it?',
        sendTrigger: 'on_resolve',
        delayMinutes: 0,
        contactCooldownMinutes: 60,
        isEnabled: true,
        createdAt: now,
        updatedAt: now,
      })
      await db
        .update(conversation)
        .set({
          status: 'resolved',
          resolvedAt: new Date(now.getTime() - 60_000),
          updatedAt: new Date(now.getTime() - 60_000),
        })
        .where(eq(conversation.id, seed.conversationId))
      await db.insert(conversationMessage).values({
        id: `csat_reply_${randomUUID()}`,
        conversationId: seed.conversationId,
        kind: 'outgoing',
        body: 'Done.',
        senderKind: 'agent',
        senderUserId: seed.userId,
        isPrivate: false,
        deliveryStatus: 'sent',
        createdAt: new Date(now.getTime() - 120_000),
      })
      return surveyId
    }

    it('skips the survey from an unauthorized sender and sends from an authorized one', async () => {
      const surveyB = await seedSurveyFor(teamB)
      const surveyA = await seedSurveyFor(teamA)
      // Make team B's inbox address sit on team A's domain: B must not send it.
      await db
        .update(supportInbox)
        .set({ emailAddress: 'support-b@acme.test' })
        .where(eq(supportInbox.id, teamB.inboxId))

      await runCsatDispatchSweep({ now: new Date() })

      expect(await db.select().from(csatResponse).where(eq(csatResponse.surveyId, surveyB))).toHaveLength(0)
      expect(await db.select().from(csatResponse).where(eq(csatResponse.surveyId, surveyA))).toHaveLength(1)
    })
  })
})
