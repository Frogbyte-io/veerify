import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization } from '../../server/database/schema/auth'
import { project } from '../../server/database/schema/feedback'
import { mailEntitlement } from '../../server/database/schema/mail'
import { mailForwardDestination, projectMailDomain } from '../../server/database/schema/support'
import { clearForwardCountCache } from '../../server/utils/mail-forward-count'
import { runMailForwardUsage } from '../../server/utils/mail-forward-usage'
import { applyForwardDestinationEvent, touchForwardDestination } from '../../server/utils/frogmail-destination-events'
import { getMailUsage } from '../../server/utils/mail-limits'
import {
  FakeSendingDomainProvider,
  resetFakeSendingDomainState,
  setFakeForwardCount,
} from '../../server/services/sending-domains/providers/fake'

/** Real Postgres, fake Frogmail provider (in-memory forward counts). */
describe('mail forwarding E3 (real Postgres)', () => {
  const suffix = randomUUID().slice(0, 8)
  const orgId = `org_fwd_${randomUUID()}`
  const projectId = `project_fwd_${randomUUID()}`
  const domainA = `a-${suffix}.example.com`
  const domainB = `b-${suffix}.example.com`
  let domainAId = ''
  let domainBId = ''
  const previousProvider = process.env.SUPPORT_SENDING_DOMAIN_PROVIDER

  async function insertDomain(domain: string, overrides: Partial<typeof projectMailDomain.$inferInsert> = {}) {
    const id = `md_${randomUUID()}`
    await db.insert(projectMailDomain).values({
      id,
      projectId,
      domain,
      registrableDomain: `${suffix}.example.com`,
      status: 'verified',
      provider: 'fake',
      providerAccountKey: '',
      providerOwnership: 'created',
      receivingStatus: 'active',
      ownershipToken: `tok_${randomUUID()}`,
      ...overrides,
    })
    return id
  }

  async function pausedAt(id: string) {
    const [row] = await db
      .select({ at: projectMailDomain.forwardingPausedAt })
      .from(projectMailDomain)
      .where(eq(projectMailDomain.id, id))
    return row?.at ?? null
  }

  beforeAll(async () => {
    process.env.SUPPORT_SENDING_DOMAIN_PROVIDER = 'fake'
    await db.insert(organization).values({ id: orgId, name: 'Fwd Org', slug: `fwd-org-${randomUUID()}` })
    await db
      .insert(project)
      .values({ id: projectId, name: 'Fwd Project', slug: `fwd-project-${randomUUID()}`, organizationId: orgId })
  })

  beforeEach(async () => {
    resetFakeSendingDomainState()
    clearForwardCountCache()
    await db.delete(mailEntitlement).where(eq(mailEntitlement.organizationId, orgId))
    await db.delete(projectMailDomain).where(eq(projectMailDomain.projectId, projectId))
    domainAId = await insertDomain(domainA)
    domainBId = await insertDomain(domainB)
    const provider = new FakeSendingDomainProvider()
    for (const domain of [domainA, domainB]) {
      await provider.register(domain)
      await provider.enableReceiving(domain)
    }
  })

  afterAll(async () => {
    if (previousProvider === undefined) delete process.env.SUPPORT_SENDING_DOMAIN_PROVIDER
    else process.env.SUPPORT_SENDING_DOMAIN_PROVIDER = previousProvider
    await db.delete(organization).where(eq(organization.id, orgId))
  })

  describe('destination webhooks', () => {
    async function insertDestination(frogmailId: string | null) {
      const id = `fd_${randomUUID()}`
      await db.insert(mailForwardDestination).values({
        id,
        projectId,
        domainId: domainAId,
        email: `owner-${randomUUID().slice(0, 6)}@example.org`,
        frogmailDestinationId: frogmailId,
      })
      return id
    }

    async function load(id: string) {
      const [row] = await db.select().from(mailForwardDestination).where(eq(mailForwardDestination.id, id))
      return row
    }

    it('verified, suspended and revoked update status, reason and timestamps', async () => {
      const frogmailId = `frogmail_${randomUUID()}`
      const id = await insertDestination(frogmailId)
      const now = new Date('2026-10-30T10:00:00Z')

      expect(
        await applyForwardDestinationEvent(
          { type: 'forward_destination.verified', data: { id: frogmailId, verified_at: '2026-10-30T09:59:00Z' } },
          now
        )
      ).toBe(true)
      let row = await load(id)
      expect(row).toMatchObject({ status: 'verified', statusReason: null })
      expect(row.verifiedAt).toEqual(new Date('2026-10-30T09:59:00Z'))
      expect(row.lastEventAt).toEqual(now)

      await applyForwardDestinationEvent(
        { type: 'forward_destination.suspended', data: { id: frogmailId, status_reason: 'bounced' } },
        now
      )
      row = await load(id)
      expect(row).toMatchObject({ status: 'suspended', statusReason: 'bounced' })
      expect(row.verifiedAt).toEqual(new Date('2026-10-30T09:59:00Z'))

      await applyForwardDestinationEvent(
        { type: 'forward_destination.revoked', data: { id: frogmailId, status_reason: 'unsubscribed' } },
        now
      )
      expect(await load(id)).toMatchObject({ status: 'revoked', statusReason: 'unsubscribed' })
    })

    it('unknown ids, unknown types and bad payloads are no-ops', async () => {
      const id = await insertDestination(`frogmail_${randomUUID()}`)
      expect(await applyForwardDestinationEvent({ type: 'forward_destination.verified', data: { id: 'nope' } })).toBe(
        false
      )
      expect(await applyForwardDestinationEvent({ type: 'inbound.received', data: { id: 'x' } })).toBe(false)
      expect(await applyForwardDestinationEvent(null)).toBe(false)
      expect(await applyForwardDestinationEvent({ type: 'forward_destination.verified' })).toBe(false)
      expect((await load(id)).status).toBe('pending')
    })

    it('a forward delivery event only stamps last_event_at', async () => {
      const frogmailId = `frogmail_${randomUUID()}`
      const id = await insertDestination(frogmailId)
      const at = new Date('2026-10-30T11:00:00Z')
      await touchForwardDestination(frogmailId, at)
      expect(await load(id)).toMatchObject({ status: 'pending', lastEventAt: at })
    })
  })

  describe('monthly usage and pause', () => {
    it('does nothing under the limit', async () => {
      setFakeForwardCount(domainA, 100)
      const result = await runMailForwardUsage()
      expect(result.paused).toBe(0)
      expect(await pausedAt(domainAId)).toBeNull()
    })

    it('pauses every receiving domain of the workspace at the limit, once', async () => {
      setFakeForwardCount(domainA, 3000)
      setFakeForwardCount(domainB, 2000)
      const provider = new FakeSendingDomainProvider()
      const spy = vi.spyOn(FakeSendingDomainProvider.prototype, 'setForwardingPaused')

      const first = await runMailForwardUsage()
      expect(first.paused).toBe(2)
      expect(await pausedAt(domainAId)).not.toBeNull()
      expect(await pausedAt(domainBId)).not.toBeNull()
      expect((await provider.getReceiving(domainA))?.forwardingPaused).toBe(true)

      const second = await runMailForwardUsage()
      expect(second.paused).toBe(0)
      expect(spy).toHaveBeenCalledTimes(2)
      spy.mockRestore()
    })

    it('ignores domains without receiving or with receiving disabled', async () => {
      await db.update(projectMailDomain).set({ receivingStatus: null }).where(eq(projectMailDomain.id, domainAId))
      await db.update(projectMailDomain).set({ receivingStatus: 'disabled' }).where(eq(projectMailDomain.id, domainBId))
      setFakeForwardCount(domainA, 99999)
      const result = await runMailForwardUsage()
      expect(result.paused).toBe(0)
      expect(await pausedAt(domainAId)).toBeNull()
    })

    it('resumes only the domains it paused once the count drops (new month)', async () => {
      setFakeForwardCount(domainA, 6000)
      await runMailForwardUsage()
      expect(await pausedAt(domainAId)).not.toBeNull()

      setFakeForwardCount(domainA, 0)
      const result = await runMailForwardUsage()
      expect(result.resumed).toBe(2)
      expect(await pausedAt(domainAId)).toBeNull()
      expect(await pausedAt(domainBId)).toBeNull()
    })

    it('does not resume a domain that was never paused by Veerify', async () => {
      const spy = vi.spyOn(FakeSendingDomainProvider.prototype, 'setForwardingPaused')
      await runMailForwardUsage()
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    })

    it('uses the tier limit: a tier change resumes a paused workspace', async () => {
      setFakeForwardCount(domainA, 6000)
      await runMailForwardUsage()
      expect(await pausedAt(domainAId)).not.toBeNull()

      await db.insert(mailEntitlement).values({ id: `me_${randomUUID()}`, organizationId: orgId, tier: 'owner' })
      const result = await runMailForwardUsage()
      expect(result.resumed).toBe(2)
      expect(await pausedAt(domainAId)).toBeNull()
    })

    it('a failing domain does not stop the pass', async () => {
      setFakeForwardCount(domainA, 6000)
      const spy = vi
        .spyOn(FakeSendingDomainProvider.prototype, 'setForwardingPaused')
        .mockRejectedValueOnce(new Error('frogmail down'))
      const result = await runMailForwardUsage()
      expect(result.errors).toBe(1)
      expect(result.paused).toBe(1)
      spy.mockRestore()
    })

    it('getMailUsage reports forwardsThisMonth', async () => {
      setFakeForwardCount(domainA, 42)
      expect((await getMailUsage(orgId)).used.forwardsThisMonth).toBe(42)
    })
  })
})
