import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization } from '../../server/database/schema/auth'
import { project } from '../../server/database/schema/feedback'
import {
  mailForwardDestination,
  projectMailAddress,
  projectMailAddressForward,
  projectMailDomain,
  supportInbox,
} from '../../server/database/schema/support'
import {
  FakeSendingDomainProvider,
  fakeForwardDestinations,
  fakeInboundRoutes,
  resetFakeSendingDomainState,
} from '../../server/services/sending-domains/providers/fake'
import { SendingDomainProviderError } from '../../server/services/sending-domains/types'
import { resyncForwardOnlyRoutes, syncAddressRoute } from '../../server/utils/inbound-routes'
import { applyForwardDestinationEvent } from '../../server/utils/frogmail-destination-events'
import { syncProjectForwardingBrand } from '../../server/utils/forwarding-brand'
import { runSendingDomainPoll, syncDomainReceiving } from '../../server/utils/sending-domain-poller'

const stubs = vi.hoisted(() => ({ provider: null as unknown }))
vi.mock('~/server/services/sending-domains', () => ({ getSendingDomainProvider: () => stubs.provider }))

/** Real Postgres with the in-memory fake provider (always forwards). */
describe('E3 domain receiving and address routes', () => {
  const suffix = randomUUID().slice(0, 8)
  const orgId = `org_fr_${suffix}`
  const projectId = `project_fr_${suffix}`
  const inboxId = `inbox_fr_${suffix}`
  const savedEnv = { ...process.env }
  const provider = new FakeSendingDomainProvider()
  let seq = 0

  async function addClaim(overrides: Partial<typeof projectMailDomain.$inferInsert> = {}) {
    const domain = `d${seq++}-${suffix}.verify-ok.test`
    const id = `md_${randomUUID()}`
    await db.insert(projectMailDomain).values({
      id,
      projectId,
      domain,
      registrableDomain: `${suffix}.verify-ok.test`,
      status: 'verified',
      provider: 'fake',
      providerAccountKey: 'fake-account',
      providerOwnership: 'created',
      receivesViaProvider: true,
      ownershipToken: `tok_${randomUUID()}`,
      nextCheckAt: new Date(Date.now() - 60_000),
      ...overrides,
    })
    await provider.register(domain)
    return { id, domain }
  }

  async function addAddress(address: string, overrides: Partial<typeof projectMailAddress.$inferInsert> = {}) {
    const id = `addr_${randomUUID()}`
    await db.insert(projectMailAddress).values({ id, inboxId, projectId, address, kind: 'custom', ...overrides })
    return id
  }

  const claimRow = async (id: string) =>
    (await db.select().from(projectMailDomain).where(eq(projectMailDomain.id, id)))[0]!

  beforeAll(async () => {
    process.env.SUPPORT_SENDING_DOMAINS_ENABLED = 'true'
    process.env.SUPPORT_SENDING_DOMAIN_PROVIDER = 'fake'
    stubs.provider = provider
    await db.insert(organization).values({ id: orgId, name: 'FR Org', slug: `fr-org-${suffix}` })
    await db.insert(project).values({ id: projectId, name: 'FR', slug: `fr-${suffix}`, organizationId: orgId })
    await db.insert(supportInbox).values({ id: inboxId, projectId, name: 'Inbox', slug: `inbox-${suffix}` })
  })

  beforeEach(async () => {
    resetFakeSendingDomainState()
    await db.delete(projectMailAddress).where(eq(projectMailAddress.inboxId, inboxId))
    await db.delete(projectMailDomain).where(eq(projectMailDomain.projectId, projectId))
  })

  afterAll(async () => {
    await db.delete(project).where(eq(project.id, projectId))
    await db.delete(organization).where(eq(organization.id, orgId))
    process.env = savedEnv
  })

  describe('syncDomainReceiving', () => {
    it('enables receiving, stores the status and MX record, and reconciles destinations', async () => {
      const { id, domain } = await addClaim({ status: 'pending' })
      // A local destination whose provider row exists (verified) but whose id we never stored,
      // and one the provider does not know.
      await provider.createForwardDestination(domain, 'confirmed-owner@example.org')
      const now = new Date()
      await db.insert(mailForwardDestination).values([
        {
          id: `fd_${randomUUID()}`,
          projectId,
          domainId: id,
          email: 'confirmed-owner@example.org',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: `fd_${randomUUID()}`,
          projectId,
          domainId: id,
          email: 'unknown@example.org',
          createdAt: now,
          updatedAt: now,
        },
      ])

      const result = await syncDomainReceiving(await claimRow(id), provider)
      expect(result).toMatchObject({ enabled: true, skipped: null, destinationsUpdated: 1 })

      const row = await claimRow(id)
      expect(row.receivingStatus).toBe('pending_verification')
      expect(row.dnsRecords.filter((r) => r.purpose === 'receiving')).toHaveLength(1)
      const destinations = await db.select().from(mailForwardDestination).where(eq(mailForwardDestination.domainId, id))
      const byEmail = new Map(destinations.map((d) => [d.email, d]))
      expect(byEmail.get('confirmed-owner@example.org')).toMatchObject({ status: 'verified' })
      expect(byEmail.get('confirmed-owner@example.org')!.frogmailDestinationId).toMatch(/^fwd_fake_/)
      expect(byEmail.get('unknown@example.org')).toMatchObject({ status: 'pending', frogmailDestinationId: null })

      // The next pass only refreshes.
      expect(await syncDomainReceiving(row, provider)).toMatchObject({ enabled: false, destinationsUpdated: 0 })
    })

    it('leaves the claim alone on provider conflict and retries later on receives-elsewhere', async () => {
      const { id, domain } = await addClaim()
      for (const [code, skipped] of [
        ['receiving_provider_conflict', 'provider_conflict'],
        ['domain_receives_elsewhere', 'receives_elsewhere'],
      ] as const) {
        const failing = Object.assign(Object.create(provider), {
          capabilities: provider.capabilities,
          enableReceiving: async () => {
            throw new SendingDomainProviderError(code, 'no', false)
          },
        })
        expect(await syncDomainReceiving(await claimRow(id), failing)).toMatchObject({ skipped })
        expect((await claimRow(id)).receivingStatus).toBeNull()
        expect((await claimRow(id)).status).toBe('verified')
      }
      expect(domain).toBeTruthy()
    })

    it('does nothing for a provider without forwarding', async () => {
      const { id } = await addClaim()
      const plain = { capabilities: { forwarding: false } } as never
      expect(await syncDomainReceiving(await claimRow(id), plain)).toMatchObject({ skipped: 'no_forwarding' })
    })

    it('runs in the poll pass for a pending claim, and a provider conflict never fails the row', async () => {
      const poll = (id: string, withProvider: unknown) => {
        const batches = [[id]]
        return runSendingDomainPoll({
          enabled: () => true,
          policy: () => 'project',
          provider: withProvider as never,
          claim: async () => {
            const batch = batches.shift()
            return batch ? db.select().from(projectMailDomain).where(inArray(projectMailDomain.id, batch)) : []
          },
          checkOwnership: async () => 'valid',
          checkDmarcRecord: async () => null,
          metric: () => true,
        })
      }

      const first = await addClaim({ status: 'pending', providerState: 'unverified', receivesViaProvider: false })
      const summary = await poll(first.id, provider)
      expect(summary).toMatchObject({ checked: 1, failed: 0 })
      expect((await claimRow(first.id)).receivingStatus).toBe('pending_verification')

      const second = await addClaim({ status: 'pending', providerState: 'unverified', receivesViaProvider: false })
      const conflicting = Object.assign(Object.create(provider), {
        capabilities: provider.capabilities,
        enableReceiving: async () => {
          throw new SendingDomainProviderError('receiving_provider_conflict', 'cloudflare', false)
        },
      })
      expect(await poll(second.id, conflicting)).toMatchObject({ checked: 1, failed: 0 })
      expect(await claimRow(second.id)).toMatchObject({ receivingStatus: null, lastErrorCode: null })
    })
  })

  describe('syncAddressRoute', () => {
    it('builds inbox + forwards, upserts destinations and links them to the address', async () => {
      const { id: claimId } = await addClaim({ receivingStatus: 'active' })
      const { domain } = await claimRow(claimId)
      await provider.enableReceiving(domain)
      const address = await addAddress(`hello@${domain}`)

      const result = await syncAddressRoute(address, {
        forwardTo: ['confirmed-me@example.org', 'you@example.org'],
        strict: true,
      })
      expect(result).toMatchObject({ status: 'active', errorCode: null })
      expect(fakeInboundRoutes()).toEqual([
        expect.objectContaining({
          forwardTo: ['confirmed-me@example.org', 'you@example.org'],
          forwardUrl: expect.stringContaining('/api/support/inbound/fake'),
        }),
      ])
      const links = await db
        .select({ email: mailForwardDestination.email, status: mailForwardDestination.status })
        .from(projectMailAddressForward)
        .innerJoin(mailForwardDestination, eq(mailForwardDestination.id, projectMailAddressForward.destinationId))
        .where(eq(projectMailAddressForward.addressId, address))
      expect(links.sort((a, b) => (a.email < b.email ? -1 : 1))).toEqual([
        { email: 'confirmed-me@example.org', status: 'verified' },
        { email: 'you@example.org', status: 'pending' },
      ])
      const [row] = await db.select().from(projectMailAddress).where(eq(projectMailAddress.id, address))
      expect(row).toMatchObject({ providerRouteStatus: 'active' })

      // Same route is updated, not duplicated; forward-only drops the inbox action.
      await db.update(projectMailAddress).set({ deliverToInbox: false }).where(eq(projectMailAddress.id, address))
      await syncAddressRoute(address, { strict: true })
      expect(fakeInboundRoutes()).toHaveLength(1)
      expect(fakeInboundRoutes()[0]).toMatchObject({ forwardUrl: null })

      // A second address on the domain shares the destination row.
      const second = await addAddress(`sales@${domain}`)
      await syncAddressRoute(second, { forwardTo: ['you@example.org'], strict: true })
      const shared = await db.select().from(mailForwardDestination).where(eq(mailForwardDestination.domainId, claimId))
      expect(shared).toHaveLength(2)
    })

    it('replaces the links when forwardTo changes, keeping the destination rows', async () => {
      const { id: claimId } = await addClaim({ receivingStatus: 'active' })
      const { domain } = await claimRow(claimId)
      await provider.enableReceiving(domain)
      const address = await addAddress(`hello@${domain}`)
      await syncAddressRoute(address, { forwardTo: ['a@example.org'], strict: true })
      await syncAddressRoute(address, { forwardTo: [], strict: true })
      expect(
        await db.select().from(projectMailAddressForward).where(eq(projectMailAddressForward.addressId, address))
      ).toEqual([])
      expect(
        await db.select().from(mailForwardDestination).where(eq(mailForwardDestination.domainId, claimId))
      ).toHaveLength(1)
    })

    it('refuses forwards strictly when receiving is not enabled, and ignores them otherwise', async () => {
      const { id: claimId } = await addClaim()
      const { domain } = await claimRow(claimId)
      const address = await addAddress(`hello@${domain}`)
      await expect(syncAddressRoute(address, { forwardTo: ['a@example.org'], strict: true })).rejects.toMatchObject({
        code: 'forward_requires_ses',
      })
      const lenient = await syncAddressRoute(address, { forwardTo: ['a@example.org'] })
      expect(lenient.status).toBe('active')
      expect(fakeInboundRoutes()[0]).toMatchObject({ forwardTo: [] })
    })

    it('marks the route failed on a provider outage unless strict forward errors apply', async () => {
      const { id: claimId } = await addClaim({ receivingStatus: 'active' })
      const { domain } = await claimRow(claimId)
      const address = await addAddress(`hello@${domain}`)
      const down = Object.assign(Object.create(provider), {
        capabilities: provider.capabilities,
        createInboundRoute: async () => {
          throw new SendingDomainProviderError('provider_unavailable', 'down', true)
        },
      })
      expect(await syncAddressRoute(address, { provider: down, strict: true })).toMatchObject({
        status: 'failed',
        errorCode: 'provider_unavailable',
      })
      const loop = Object.assign(Object.create(provider), {
        capabilities: provider.capabilities,
        createInboundRoute: async () => {
          throw new SendingDomainProviderError('forward_would_loop', 'loop', false)
        },
      })
      await expect(
        syncAddressRoute(address, { provider: loop, forwardTo: ['a@example.org'], strict: true })
      ).rejects.toMatchObject({
        code: 'forward_would_loop',
      })
    })
  })

  describe('forward-only inbox fallback', () => {
    const addressRow = async (id: string) =>
      (await db.select().from(projectMailAddress).where(eq(projectMailAddress.id, id)))[0]!
    const destinationEvent = (type: string, email: string) => {
      const remote = fakeForwardDestinations().find((item) => item.email === email)!
      return { type: `forward_destination.${type}`, data: { id: remote.id, status_reason: 'unsubscribed' } }
    }
    const setRemoteStatus = (email: string, status: 'verified' | 'revoked') =>
      Object.assign(fakeForwardDestinations().find((item) => item.email === email)!, { status })

    async function receivingDomain() {
      const { id: claimId } = await addClaim({ receivingStatus: 'active' })
      const { domain } = await claimRow(claimId)
      await provider.enableReceiving(domain)
      return { claimId, domain }
    }

    it('delivers to the inbox until a forward is confirmed, then re-syncs to forward-only and back', async () => {
      const { claimId, domain } = await receivingDomain()
      const address = await addAddress(`hello@${domain}`, { deliverToInbox: false })

      const created = await syncAddressRoute(address, {
        deliverToInbox: false,
        forwardTo: ['you@example.org'],
        strict: true,
      })
      expect(created).toMatchObject({ status: 'active', inboxFallback: true })
      expect(fakeInboundRoutes()[0]).toMatchObject({
        forwardUrl: expect.stringContaining('/api/support/inbound/fake'),
        forwardTo: ['you@example.org'],
      })
      expect(await addressRow(address)).toMatchObject({ providerRouteInboxFallback: true })

      // Idempotent: nothing changed, so no provider call.
      const update = vi.spyOn(provider, 'updateInboundRoute')
      expect(await resyncForwardOnlyRoutes({ domainId: claimId })).toBe(0)
      expect(update).not.toHaveBeenCalled()

      // The recipient confirms (Frogmail webhook): the inbox action goes away.
      setRemoteStatus('you@example.org', 'verified')
      expect(await applyForwardDestinationEvent(destinationEvent('verified', 'you@example.org'))).toBe(true)
      expect(update).toHaveBeenCalledTimes(1)
      expect(fakeInboundRoutes()).toHaveLength(1)
      expect(fakeInboundRoutes()[0]).toMatchObject({ forwardUrl: null, forwardTo: ['you@example.org'] })
      expect(await addressRow(address)).toMatchObject({ providerRouteInboxFallback: false })

      // A redelivered webhook changes nothing at the provider.
      await applyForwardDestinationEvent(destinationEvent('verified', 'you@example.org'))
      expect(update).toHaveBeenCalledTimes(1)

      // The only confirmed recipient stops forwarding: back to the inbox, so no mail is lost.
      setRemoteStatus('you@example.org', 'revoked')
      await applyForwardDestinationEvent(destinationEvent('revoked', 'you@example.org'))
      expect(fakeInboundRoutes()[0]).toMatchObject({ forwardUrl: expect.stringContaining('/api/support/inbound/') })
      expect(await addressRow(address)).toMatchObject({ providerRouteInboxFallback: true })
      update.mockRestore()
    })

    it('skips the fallback when the forward is already confirmed for the domain', async () => {
      const { domain } = await receivingDomain()
      const address = await addAddress(`sales@${domain}`, { deliverToInbox: false })
      // `confirmed*` is verified by the fake on creation: the route response, not the local view, decides.
      const result = await syncAddressRoute(address, {
        deliverToInbox: false,
        forwardTo: ['confirmed-owner@example.org'],
        strict: true,
      })
      expect(result).toMatchObject({ status: 'active', inboxFallback: false })
      expect(fakeInboundRoutes()[0]).toMatchObject({ forwardUrl: null })
    })

    it('heals a forward-only route built before the fallback on the daily receiving sync', async () => {
      const { claimId, domain } = await receivingDomain()
      const address = await addAddress(`old@${domain}`, { deliverToInbox: false })
      await syncAddressRoute(address, { deliverToInbox: false, forwardTo: ['late@example.org'], strict: true })
      // Simulate the pre-fallback state: a route without the inbox action, marker off.
      await provider.updateInboundRoute((await addressRow(address)).providerRouteId!, {
        address: `old@${domain}`,
        forwardUrl: null,
        forwardTo: ['late@example.org'],
        description: 'pre-fallback',
      })
      await db
        .update(projectMailAddress)
        .set({ providerRouteInboxFallback: false })
        .where(eq(projectMailAddress.id, address))

      await syncDomainReceiving(await claimRow(claimId), provider)

      expect(fakeInboundRoutes()[0]).toMatchObject({ forwardUrl: expect.stringContaining('/api/support/inbound/') })
      expect(await addressRow(address)).toMatchObject({ providerRouteInboxFallback: true })
    })
  })

  describe('forwarding brand name', () => {
    it('sends the project name when receiving is enabled and again after a rename', async () => {
      const { id: claimId, domain } = await addClaim()
      await syncDomainReceiving(await claimRow(claimId), provider)
      expect((await provider.getReceiving(domain))?.forwardingBrandName).toBe('FR')

      await db.update(project).set({ name: 'FR\nRenamed  Co' }).where(eq(project.id, projectId))
      try {
        expect(await syncProjectForwardingBrand(projectId, { provider })).toBe(1)
        expect((await provider.getReceiving(domain))?.forwardingBrandName).toBe('FR Renamed Co')

        // Drift (e.g. a missed rename) is corrected by the poller, which compares with what Frogmail reports.
        await provider.setForwardingBrandName(domain, 'Stale')
        await syncDomainReceiving(await claimRow(claimId), provider)
        expect((await provider.getReceiving(domain))?.forwardingBrandName).toBe('FR Renamed Co')
      } finally {
        await db.update(project).set({ name: 'FR' }).where(eq(project.id, projectId))
      }
    })

    it('keeps working against a Frogmail that refuses the brand PATCH', async () => {
      const { id: claimId, domain } = await addClaim({ receivingStatus: 'active' })
      await provider.enableReceiving(domain)
      const older = Object.assign(Object.create(provider), {
        capabilities: provider.capabilities,
        // An older Frogmail: no brand field in GET, 422 on a PATCH without forwarding_paused.
        getReceiving: async (name: string) => {
          const { forwardingBrandName: _ignored, ...state } = (await provider.getReceiving(name))!
          return state
        },
        setForwardingBrandName: async () => {
          throw new SendingDomainProviderError('invalid_domain', 'The forwarding paused field is required.', false)
        },
      })
      expect(await syncDomainReceiving(await claimRow(claimId), older)).toMatchObject({ skipped: null })
      expect(await syncProjectForwardingBrand(projectId, { provider: older })).toBe(0)
    })
  })
})
