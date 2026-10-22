import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, team, user } from '../../server/database/schema/auth'
import { supportSendingDomain } from '../../server/database/schema/support'
import {
  createSendingDomainClaim,
  getTeamSendingDomain,
  listTeamSendingDomains,
  toSendingDomainView,
} from '../../server/utils/sending-domains'

const now = new Date('2026-10-22T12:00:00.000Z')
const run = randomUUID().slice(0, 8)
const ids = {
  org: `sdc_org_${run}`,
  teamA: `sdc_team_a_${run}`,
  teamB: `sdc_team_b_${run}`,
  teamC: `sdc_team_c_${run}`,
  user: `sdc_user_${run}`,
}
const provider = { provider: 'mailgun', providerAccountKey: 'acct-1' }
const savedEnv = { ...process.env }

/** A fresh registrable domain per test, so rows from other tests never interfere. */
const fresh = () => `c${randomUUID().replace(/-/g, '').slice(0, 12)}.com`

function claim(teamId: string, domain: string, extra: Partial<Parameters<typeof createSendingDomainClaim>[0]> = {}) {
  return createSendingDomainClaim({ teamId, domain, userId: ids.user, ...provider, now, ...extra })
}

async function expectRejection(promise: Promise<unknown>, statusCode: number, code: string) {
  const error = (await promise.then(
    () => null,
    (e: unknown) => e
  )) as { statusCode?: number; data?: { code?: string; error?: { code?: string } } } | null
  expect(error, 'expected the claim to be rejected').not.toBeNull()
  expect(error?.statusCode).toBe(statusCode)
  expect(error?.data?.code).toBe(code)
  expect(error?.data?.error?.code).toBe(code)
}

beforeAll(async () => {
  process.env.SUPPORT_SENDING_DOMAINS_ENABLED = 'true'
  await db
    .insert(organization)
    .values({ id: ids.org, name: 'SDC org', slug: `sdc-${run}`, createdAt: now, updatedAt: now })
  await db
    .insert(user)
    .values({ id: ids.user, name: 'SDC admin', email: `sdc-${run}@example.com`, createdAt: now, updatedAt: now })
})

// Fresh teams per test: the per-team limits would otherwise leak between tests.
const createdTeams: string[] = []
beforeEach(async () => {
  const n = createdTeams.length
  ids.teamA = `sdc_team_a_${run}_${n}`
  ids.teamB = `sdc_team_b_${run}_${n}`
  ids.teamC = `sdc_team_c_${run}_${n}`
  const teamIds = [ids.teamA, ids.teamB, ids.teamC]
  createdTeams.push(...teamIds)
  await db
    .insert(team)
    .values(teamIds.map((id) => ({ id, name: id, slug: id, organizationId: ids.org, createdAt: now, updatedAt: now })))
})

afterAll(async () => {
  process.env = savedEnv
  await db.delete(team).where(inArray(team.id, createdTeams))
  await db.delete(organization).where(eq(organization.id, ids.org))
  await db.delete(user).where(eq(user.id, ids.user))
})

describe('createSendingDomainClaim', () => {
  it('inserts a provisioning claim with an ownership token and TXT record', async () => {
    const domain = fresh()
    const row = await claim(ids.teamA, `  ${domain.toUpperCase()}. `)

    expect(row.domain).toBe(domain)
    expect(row.registrableDomain).toBe(domain)
    expect(row.status).toBe('provisioning')
    expect(row.provider).toBe('mailgun')
    expect(row.providerAccountKey).toBe('acct-1')
    expect(row.ownershipToken.length).toBeGreaterThanOrEqual(24)
    expect(row.expiresAt).toEqual(new Date(now.getTime() + 7 * 24 * 3600 * 1000))
    expect(row.dnsRecords).toEqual([
      {
        purpose: 'ownership',
        type: 'TXT',
        name: `_veerify-mail.${domain}`,
        value: `veerify-mail-verification=${row.ownershipToken}`,
        status: 'unknown',
      },
    ])
  })

  it('lets exactly one of two teams claim the same domain concurrently', async () => {
    const domain = fresh()
    const results = await Promise.allSettled([claim(ids.teamA, domain), claim(ids.teamB, domain)])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason.statusCode).toBe(409)
    expect(rejected.reason.data.code).toBe('DOMAIN_CLAIMED')
    const rows = await db.select().from(supportSendingDomain).where(eq(supportSendingDomain.domain, domain))
    expect(rows).toHaveLength(1)
  })

  it('serializes an ancestor and a descendant claimed concurrently by different teams', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const domain = fresh()
      const results = await Promise.allSettled([claim(ids.teamA, domain), claim(ids.teamB, `mail.${domain}`)])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const rows = await db
        .select()
        .from(supportSendingDomain)
        .where(eq(supportSendingDomain.registrableDomain, domain))
      expect(rows).toHaveLength(1)
    }
  })

  it('refuses ancestors and descendants of another team claim, in any status, but not lookalikes', async () => {
    const domain = fresh()
    await claim(ids.teamA, `mail.${domain}`)

    await expectRejection(claim(ids.teamB, domain), 409, 'DOMAIN_CLAIMED')
    await expectRejection(claim(ids.teamB, `x.mail.${domain}`), 409, 'DOMAIN_CLAIMED')
    await expectRejection(claim(ids.teamB, `mail.${domain}`), 409, 'DOMAIN_CLAIMED')
    await expect(claim(ids.teamB, `bad${domain}`)).resolves.toMatchObject({ teamId: ids.teamB })
  })

  it('allows nesting within one team and rejects a duplicate', async () => {
    const domain = fresh()
    await claim(ids.teamA, domain)
    await expect(claim(ids.teamA, `mail.${domain}`)).resolves.toMatchObject({ teamId: ids.teamA })
    await expectRejection(claim(ids.teamA, domain), 409, 'DOMAIN_ALREADY_REGISTERED')
  })

  it('rejects invalid, reserved and mailbox-provider names with 422', async () => {
    process.env.APP_DOMAIN = 'app.reserved-sdc.com'
    process.env.SUPPORT_SENDING_DOMAINS_RESERVED = 'extra-sdc.org, other-sdc.org'
    try {
      await expectRejection(claim(ids.teamC, 'not a domain'), 422, 'DOMAIN_REJECTED')
      await expectRejection(claim(ids.teamC, '10.0.0.1'), 422, 'DOMAIN_REJECTED')
      await expectRejection(claim(ids.teamC, 'gmail.com'), 422, 'DOMAIN_REJECTED')
      await expectRejection(claim(ids.teamC, 'reserved-sdc.com'), 422, 'DOMAIN_REJECTED')
      await expectRejection(claim(ids.teamC, 'x.app.reserved-sdc.com'), 422, 'DOMAIN_REJECTED')
      await expectRejection(claim(ids.teamC, 'mail.extra-sdc.org'), 422, 'DOMAIN_REJECTED')
      await expectRejection(claim(ids.teamC, 'acme.verify-ok.test'), 422, 'DOMAIN_REJECTED')
      await expect(claim(ids.teamC, 'acme.verify-ok.test', { provider: 'fake' })).resolves.toMatchObject({
        registrableDomain: 'verify-ok.test',
      })
    } finally {
      delete process.env.APP_DOMAIN
      delete process.env.SUPPORT_SENDING_DOMAINS_RESERVED
      await db.delete(supportSendingDomain).where(eq(supportSendingDomain.teamId, ids.teamC))
    }
  })

  it('enforces the pending limit, which verified claims do not count against', async () => {
    const created = []
    for (let i = 0; i < 3; i++) created.push(await claim(ids.teamC, fresh()))
    await expectRejection(claim(ids.teamC, fresh()), 409, 'PENDING_LIMIT_REACHED')

    await db
      .update(supportSendingDomain)
      .set({ status: 'verified' })
      .where(
        inArray(
          supportSendingDomain.id,
          created.map((row) => row.id)
        )
      )
    await expect(claim(ids.teamC, fresh())).resolves.toMatchObject({ status: 'provisioning' })
  })

  it('enforces the total limit and does not count claims being deleted', async () => {
    const rows = await listTeamSendingDomains(ids.teamC)
    for (let i = rows.length; i < 10; i++) {
      const domain = fresh()
      await db.insert(supportSendingDomain).values({
        id: randomUUID(),
        teamId: ids.teamC,
        domain,
        registrableDomain: domain,
        status: 'verified',
        provider: 'mailgun',
        ownershipToken: 'tok',
      })
    }
    await expectRejection(claim(ids.teamC, fresh()), 409, 'DOMAIN_LIMIT_REACHED')

    const [one] = await listTeamSendingDomains(ids.teamC)
    await db.update(supportSendingDomain).set({ status: 'deleting' }).where(eq(supportSendingDomain.id, one.id))
    await expect(claim(ids.teamC, fresh())).resolves.toMatchObject({ teamId: ids.teamC })
  })
})

describe('team-scoped reads', () => {
  it('lists only the team claims and returns 404 across teams', async () => {
    const domain = fresh()
    const row = await claim(ids.teamA, domain)

    expect((await listTeamSendingDomains(ids.teamA)).some((r) => r.id === row.id)).toBe(true)
    expect((await listTeamSendingDomains(ids.teamB)).some((r) => r.id === row.id)).toBe(false)
    await expect(getTeamSendingDomain(ids.teamA, row.id)).resolves.toMatchObject({ domain })
    await expect(getTeamSendingDomain(ids.teamB, row.id)).rejects.toMatchObject({ statusCode: 404 })
    await expect(getTeamSendingDomain(ids.teamA, randomUUID())).rejects.toMatchObject({ statusCode: 404 })
  })

  it('maps a row to a view and flags a provider mismatch', async () => {
    const row = await claim(ids.teamA, fresh())

    const view = toSendingDomainView(row, { name: 'mailgun', accountKey: 'acct-1' })
    expect(view).toMatchObject({
      id: row.id,
      status: 'provisioning',
      providerState: null,
      ownershipVerified: false,
      providerOwnership: null,
      providerMismatch: false,
      lastCheckedAt: null,
    })
    expect(view.expiresAt).toBe(row.expiresAt?.toISOString())
    expect(view.records[0].purpose).toBe('ownership')
    expect(toSendingDomainView(row, { name: 'mailgun', accountKey: 'acct-2' }).providerMismatch).toBe(true)
    expect(toSendingDomainView(row, { name: 'postmark', accountKey: 'acct-1' }).providerMismatch).toBe(true)
  })
})
