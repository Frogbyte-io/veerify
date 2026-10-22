import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, team } from '../../server/database/schema/auth'
import { supportSendingDomain } from '../../server/database/schema/support'
import { claimDueSendingDomains, runSendingDomainPoll } from '../../server/utils/sending-domain-poller'

/**
 * Needs WP1 (schema is already present; `applyProviderResult`) and WP2
 * (`ownership.ts`) merged: the poller imports them. The claim itself is one atomic
 * UPDATE over a `FOR UPDATE SKIP LOCKED` selection, which a fake database cannot
 * exercise, so this runs against real Postgres like the outbox suite.
 */
describe('sending-domain poller (real Postgres)', () => {
  const orgId = `org_sdpoll_${randomUUID()}`
  const teamId = `team_sdpoll_${randomUUID()}`
  const suffix = randomUUID().slice(0, 8)
  const past = () => new Date(Date.now() - 60_000)
  const ids: string[] = []

  async function insertDomain(name: string, overrides: Partial<typeof supportSendingDomain.$inferInsert> = {}) {
    const id = `sd_${randomUUID()}`
    ids.push(id)
    await db.insert(supportSendingDomain).values({
      id,
      teamId,
      domain: `${name}-${suffix}.example.com`,
      registrableDomain: `${suffix}.example.com`,
      status: 'pending',
      provider: 'fake',
      providerAccountKey: '',
      providerOwnership: 'adopted',
      ownershipToken: `tok_${randomUUID()}`,
      nextCheckAt: past(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ...overrides,
    })
    return id
  }

  function makeProvider(onGet: (domain: string) => void, remove = vi.fn(async () => ({ cleanup: null }))) {
    return {
      name: 'fake',
      accountKey: '',
      capabilities: { register: true, verifyNow: true, remove: true, inboundRoutes: false, authorizesSubdomains: true },
      isConfigured: () => ({ configured: true, missing: [] }),
      register: vi.fn(),
      get: vi.fn(async (domain: string) => {
        onGet(domain)
        // Hold the lease long enough for the other pass to run its own claim.
        await new Promise((resolve) => setTimeout(resolve, 25))
        return { domain, state: 'unverified' as const, receivesMail: false, records: [], message: null }
      }),
      verify: vi.fn(),
      remove,
    }
  }

  beforeAll(async () => {
    await db.insert(organization).values({ id: orgId, name: 'SD Poll Org', slug: `sdpoll-org-${randomUUID()}` })
    await db
      .insert(team)
      .values({ id: teamId, name: 'SD Poll Team', slug: `sdpoll-team-${randomUUID()}`, organizationId: orgId })
  })

  beforeEach(async () => {
    // Other suites' rows must not be claimed by (or interfere with) these passes.
    await db.delete(supportSendingDomain).where(inArray(supportSendingDomain.id, ids.splice(0)))
  })

  afterAll(async () => {
    await db.delete(organization).where(eq(organization.id, orgId))
  })

  it('two concurrent claims never return the same row', async () => {
    const inserted = await Promise.all(Array.from({ length: 10 }, (_, i) => insertDomain(`claim${i}`)))

    const [a, b] = await Promise.all([claimDueSendingDomains({ limit: 5 }), claimDueSendingDomains({ limit: 5 })])
    const claimedA = a.map((row) => row.id)
    const claimedB = b.map((row) => row.id)

    expect(claimedA.filter((id) => claimedB.includes(id))).toEqual([])
    const mine = (list: string[]) => list.filter((id) => inserted.includes(id))
    expect(mine(claimedA).length + mine(claimedB).length).toBe(10)

    // A leased row is invisible to a later claim until the lease lapses.
    expect(await claimDueSendingDomains({ limit: 25 })).toEqual([])
    const [row] = await db.select().from(supportSendingDomain).where(eq(supportSendingDomain.id, inserted[0]!))
    expect(row!.leaseExpiresAt).not.toBeNull()
  })

  it('picks a row up again once its lease has expired', async () => {
    const id = await insertDomain('lease', { leaseExpiresAt: new Date(Date.now() - 1000) })
    const claimed = await claimDueSendingDomains({ limit: 25 })
    expect(claimed.map((row) => row.id)).toContain(id)
  })

  it('two concurrent poll passes never process the same row', async () => {
    const inserted = await Promise.all(Array.from({ length: 12 }, (_, i) => insertDomain(`pass${i}`)))
    const calls: string[] = []
    const provider = makeProvider((domain) => calls.push(domain))
    const deps = {
      enabled: () => true,
      policy: () => 'team' as const,
      provider: provider as never,
      batchSize: 2,
      checkOwnership: async () => 'invalid' as const,
      checkDmarcRecord: async () => null,
      metric: () => true,
    }

    const [a, b] = await Promise.all([runSendingDomainPoll(deps), runSendingDomainPoll(deps)])

    const mineCalls = calls.filter((domain) => inserted.some((_, i) => domain.startsWith(`pass${i}-`)))
    expect(new Set(mineCalls).size).toBe(mineCalls.length)
    expect(mineCalls).toHaveLength(12)
    expect(a.processed + b.processed).toBeGreaterThanOrEqual(12)
    // Both passes actually took part; otherwise this proves nothing about concurrency.
    expect(a.processed).toBeGreaterThan(0)
    expect(b.processed).toBeGreaterThan(0)

    const rows = await db.select().from(supportSendingDomain).where(inArray(supportSendingDomain.id, inserted))
    for (const row of rows) {
      expect(row.leaseExpiresAt).toBeNull()
      expect(row.lastCheckedAt).not.toBeNull()
      expect(row.nextCheckAt!.getTime()).toBeGreaterThan(Date.now())
    }
  })

  it('expires a pending claim: removes the provider domain Veerify created and deletes the row', async () => {
    const id = await insertDomain('expire', { providerOwnership: 'created', expiresAt: new Date(Date.now() - 1000) })
    const remove = vi.fn(async () => ({ cleanup: null }))
    const provider = makeProvider(() => undefined, remove)

    const summary = await runSendingDomainPoll({
      enabled: () => true,
      policy: () => 'team',
      provider: provider as never,
      metric: () => true,
    })

    expect(summary.expired).toBeGreaterThanOrEqual(1)
    expect(remove).toHaveBeenCalledTimes(1)
    const rows = await db.select().from(supportSendingDomain).where(eq(supportSendingDomain.id, id))
    expect(rows).toEqual([])
  })
})
