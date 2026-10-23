import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../server/database/drizzle'
import { supportInboxAddress } from '../../server/database/schema/support'
import {
  deleteOrganization,
  seedOrganization,
  seedSendingDomain,
  seedTeamWithInbox,
  type SeededTeam,
} from './helpers/sender-seed'

/**
 * Platform forwarding addresses (design §9.1) and direct-receiving routes
 * (§9.2) against real Postgres. `server/utils/sending-domains` (WP1) and the
 * provider (WP2) are mocked: the suite is about how WP4 uses them.
 */

const sendingDomains = vi.hoisted(() => ({
  isSendingDomainsEnabled: vi.fn(() => true),
  resolveSenderPolicy: vi.fn(() => 'team' as 'legacy' | 'team'),
  resolveTeamSenderAuthorization: vi.fn(),
}))
const provider = vi.hoisted(() => ({
  current: null as null | Record<string, unknown>,
  createInboundRoute: vi.fn(),
  deleteInboundRoute: vi.fn(),
}))

vi.mock('../../server/utils/sending-domains', () => sendingDomains)
vi.mock('../../server/services/sending-domains', () => ({ getSendingDomainProvider: () => provider.current }))

const { ensurePlatformAddress, findPlatformAddress } = await import('../../server/utils/platform-address')
const { createDirectRouteForAddress, deleteDirectRouteForAddress } = await import('../../server/utils/inbound-routes')
const { resolveInboxByAddress } = await import('../../server/utils/support-access')

let orgId: string
let teamA: SeededTeam
let teamB: SeededTeam

beforeAll(async () => {
  orgId = await seedOrganization('platform')
  teamA = await seedTeamWithInbox(orgId, 'platforma', 'support@acme.com')
  teamB = await seedTeamWithInbox(orgId, 'platformb', 'support@teamb.com')
})

afterAll(async () => {
  await deleteOrganization(orgId)
})

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('SUPPORT_PLATFORM_MAIL_DOMAIN', 'veerifymail.test')
  provider.current = {
    name: 'mailgun',
    accountKey: 'acct',
    capabilities: { inboundRoutes: true, authorizesSubdomains: true },
    createInboundRoute: provider.createInboundRoute,
    deleteInboundRoute: provider.deleteInboundRoute,
  }
  provider.createInboundRoute.mockReset().mockResolvedValue({ routeId: 'route-1' })
  provider.deleteInboundRoute.mockReset().mockResolvedValue(undefined)
  sendingDomains.isSendingDomainsEnabled.mockReturnValue(true)
})

const ensure = (seed: SeededTeam, options: { regenerate?: boolean } = {}) =>
  db.transaction((tx) => ensurePlatformAddress(tx, { id: seed.inboxId, slug: seed.inboxSlug }, seed.teamSlug, options))

describe('platform address generation', () => {
  it('creates one platform address per inbox, idempotently, on the platform domain', async () => {
    const first = await ensure(teamA)
    const second = await ensure(teamA)

    expect(first?.kind).toBe('platform')
    expect(first?.address).toMatch(/^platforma-[0-9a-f]{8}-platforma-inbox-[a-z2-7]{6}@veerifymail\.test$/)
    expect(second?.id).toBe(first?.id)

    const rows = await db
      .select()
      .from(supportInboxAddress)
      .where(and(eq(supportInboxAddress.inboxId, teamA.inboxId), eq(supportInboxAddress.kind, 'platform')))
    expect(rows).toHaveLength(1)
  })

  it('creates exactly one row when requests race', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => ensure(teamB)))

    expect(new Set(results.map((row) => row?.id)).size).toBe(1)
    const rows = await db
      .select()
      .from(supportInboxAddress)
      .where(and(eq(supportInboxAddress.inboxId, teamB.inboxId), eq(supportInboxAddress.kind, 'platform')))
    expect(rows).toHaveLength(1)
  })

  it('routes mail for the platform address to its inbox', async () => {
    const created = await ensure(teamA)

    const resolved = await resolveInboxByAddress(created!.address)

    expect(resolved?.inbox.id).toBe(teamA.inboxId)
    expect(resolved?.address.kind).toBe('platform')
  })

  it('regenerate replaces the address and the old one stops resolving', async () => {
    const before = await ensure(teamA)
    const after = await ensure(teamA, { regenerate: true })

    expect(after?.address).not.toBe(before?.address)
    expect(await resolveInboxByAddress(before!.address)).toBeNull()
    expect((await findPlatformAddress(teamA.inboxId))?.id).toBe(after?.id)
  })

  it('does nothing without a platform domain', async () => {
    vi.stubEnv('SUPPORT_PLATFORM_MAIL_DOMAIN', '')
    const seed = await seedTeamWithInbox(orgId, 'platformc', 'support@c.example')

    expect(await ensure(seed)).toBeNull()
    expect(await findPlatformAddress(seed.inboxId)).toBeNull()
  })
})

describe('direct receiving routes', () => {
  async function addAddress(seed: SeededTeam, address: string, kind = 'custom') {
    const [row] = await db
      .insert(supportInboxAddress)
      .values({ id: `addr_${randomUUID()}`, inboxId: seed.inboxId, address, kind })
      .returning()
    return row
  }

  it('creates a route for an address on a verified, receiving claim and stores its id', async () => {
    await seedSendingDomain({ teamId: teamA.teamId, domain: 'route-ok.example', receivesViaProvider: true })
    const row = await addAddress(teamA, 'help@route-ok.example')

    const status = await createDirectRouteForAddress({ teamId: teamA.teamId, inboxId: teamA.inboxId, address: row })

    expect(status).toBe('active')
    expect(provider.createInboundRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        address: 'help@route-ok.example',
        description: `veerify:${teamA.inboxId}:${row.id}`,
        forwardUrl: expect.stringMatching(/\/api\/support\/inbound\/mailgun$/),
      })
    )
    const [stored] = await db.select().from(supportInboxAddress).where(eq(supportInboxAddress.id, row.id))
    expect(stored).toMatchObject({ providerRouteId: 'route-1', providerRouteStatus: 'active' })
  })

  it('marks the route failed, keeps the address, and does not throw when the provider errors', async () => {
    await seedSendingDomain({ teamId: teamA.teamId, domain: 'route-fail.example', receivesViaProvider: true })
    const row = await addAddress(teamA, 'help@route-fail.example')
    provider.createInboundRoute.mockRejectedValueOnce(new Error('provider down'))

    const status = await createDirectRouteForAddress({ teamId: teamA.teamId, inboxId: teamA.inboxId, address: row })

    expect(status).toBe('failed')
    const [stored] = await db.select().from(supportInboxAddress).where(eq(supportInboxAddress.id, row.id))
    expect(stored).toMatchObject({ providerRouteId: null, providerRouteStatus: 'failed' })
  })

  it.each([
    ['an unverified claim', { status: 'pending', receivesViaProvider: true }, 'help@route-pending.example'],
    ['a claim the provider does not receive for', { receivesViaProvider: false }, 'help@route-norecv.example'],
    ['a subdomain of a claim (cannot receive directly)', { receivesViaProvider: true }, 'help@sub.route-sub.example'],
  ])('creates no route for %s', async (_label, claim, address) => {
    const domain = address.includes('sub.') ? 'route-sub.example' : address.split('@')[1]
    await seedSendingDomain({ teamId: teamA.teamId, domain, ...claim })
    const row = await addAddress(teamA, address)

    expect(await createDirectRouteForAddress({ teamId: teamA.teamId, inboxId: teamA.inboxId, address: row })).toBeNull()
    expect(provider.createInboundRoute).not.toHaveBeenCalled()
  })

  it("creates no route on another team's claim", async () => {
    await seedSendingDomain({ teamId: teamB.teamId, domain: 'route-other.example', receivesViaProvider: true })
    const row = await addAddress(teamA, 'help@route-other.example')

    expect(await createDirectRouteForAddress({ teamId: teamA.teamId, inboxId: teamA.inboxId, address: row })).toBeNull()
  })

  it('creates no route when management is disabled or the provider has no routes', async () => {
    await seedSendingDomain({ teamId: teamA.teamId, domain: 'route-off.example', receivesViaProvider: true })
    const row = await addAddress(teamA, 'help@route-off.example')

    sendingDomains.isSendingDomainsEnabled.mockReturnValue(false)
    expect(await createDirectRouteForAddress({ teamId: teamA.teamId, inboxId: teamA.inboxId, address: row })).toBeNull()

    sendingDomains.isSendingDomainsEnabled.mockReturnValue(true)
    provider.current = { ...provider.current!, capabilities: { inboundRoutes: false, authorizesSubdomains: false } }
    expect(await createDirectRouteForAddress({ teamId: teamA.teamId, inboxId: teamA.inboxId, address: row })).toBeNull()
  })

  it('never routes a platform address', async () => {
    const row = await addAddress(teamA, `platform-${randomUUID()}@veerifymail.test`, 'platform')

    expect(await createDirectRouteForAddress({ teamId: teamA.teamId, inboxId: teamA.inboxId, address: row })).toBeNull()
  })

  it('deletes a route best-effort and swallows provider errors', async () => {
    await deleteDirectRouteForAddress({ id: 'a', providerRouteId: 'route-9' })
    expect(provider.deleteInboundRoute).toHaveBeenCalledWith('route-9')

    provider.deleteInboundRoute.mockRejectedValueOnce(new Error('gone'))
    await expect(deleteDirectRouteForAddress({ id: 'a', providerRouteId: 'route-9' })).resolves.toBeUndefined()

    provider.deleteInboundRoute.mockClear()
    await deleteDirectRouteForAddress({ id: 'a', providerRouteId: null })
    expect(provider.deleteInboundRoute).not.toHaveBeenCalled()
  })
})
