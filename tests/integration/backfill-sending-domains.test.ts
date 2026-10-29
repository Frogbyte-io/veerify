import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Always the scratch database, never the shared dev or integration ones.
// Prepare it once: PGDATABASE=veerify_backfill yarn db:migrate
vi.hoisted(() => {
  delete process.env.DATABASE_URL
  process.env.PGHOST = 'localhost'
  process.env.PGPORT = '5432'
  process.env.PGUSER = 'veerify'
  process.env.PGPASSWORD = 'veerifypassword'
  process.env.PGDATABASE = 'veerify_backfill'
  process.env.SUPPORT_SENDING_DOMAINS_ENABLED = 'true'
  process.env.SUPPORT_SENDING_DOMAIN_PROVIDER = 'fake'
})

/* eslint-disable import/first -- the env must be set before the database module loads */
import { db } from '../../server/database/drizzle'
import { organization, user } from '../../server/database/schema/auth'
import { project, projectMember } from '../../server/database/schema/feedback'
import { supportInbox, projectMailAddress, projectMailDomain } from '../../server/database/schema/support'
import { FakeSendingDomainProvider } from '../../server/services/sending-domains/providers/fake'
import { parseArgs, productionDatabaseReason, runBackfill } from '../../scripts/backfill-sending-domains'
/* eslint-enable import/first */

const run = randomUUID().slice(0, 8)
const now = new Date('2026-10-22T12:00:00.000Z')
const orgId = `bf_org_${run}`
const userA = `bf_user_a_${run}`
const userB = `bf_user_b_${run}`
const projects = { a: `bf_project_a_${run}`, b: `bf_project_b_${run}`, c: `bf_project_c_${run}` }
const provider = new FakeSendingDomainProvider()
const sleep = async () => {}

const fresh = (suffix = 'verify-ok.test') => `d${randomUUID().replace(/-/g, '').slice(0, 10)}.${suffix}`

/** Registers and verifies a domain so the fake provider reports it `active`. */
async function activeOnProvider(domain: string) {
  await provider.register(domain)
  await provider.verify(domain)
}

async function addInbox(projectId: string, address: string | null, extraAddresses: string[] = []) {
  const id = `bf_inbox_${randomUUID()}`
  await db.insert(supportInbox).values({
    id,
    projectId,
    name: id,
    slug: id,
    emailAddress: address,
    createdAt: now,
    updatedAt: now,
  })
  for (const extra of extraAddresses) {
    await db
      .insert(projectMailAddress)
      .values({ id: `bf_addr_${randomUUID()}`, inboxId: id, projectId, address: extra })
  }
}

const scoped = (apply: boolean, ...ids: string[]) => ({ apply, projectIds: ids, delayMs: 0, now })
const deps = { provider, sleep }

async function claimsFor(projectId: string) {
  return db.select().from(projectMailDomain).where(eq(projectMailDomain.projectId, projectId))
}

beforeAll(async () => {
  expect(process.env.PGDATABASE).toBe('veerify_backfill')
  await db.insert(organization).values({ id: orgId, name: 'BF org', slug: `bf-${run}`, createdAt: now, updatedAt: now })
  await db.insert(user).values([
    { id: userA, name: 'A', email: `bf-a-${run}@example.com`, createdAt: now, updatedAt: now },
    { id: userB, name: 'B', email: `bf-b-${run}@example.com`, createdAt: now, updatedAt: now },
  ])
  await db.insert(project).values(
    Object.values(projects).map((id) => ({
      id,
      name: id,
      slug: id,
      organizationId: orgId,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(projectMember).values([
    {
      id: `bf_m_${run}_1`,
      projectId: projects.a,
      userId: userB,
      role: 'member',
      createdAt: new Date(now.getTime() - 1000),
    },
    { id: `bf_m_${run}_2`, projectId: projects.a, userId: userA, role: 'admin', createdAt: now },
  ])
})

afterAll(async () => {
  await db.delete(project).where(inArray(project.id, Object.values(projects)))
  await db.delete(organization).where(eq(organization.id, orgId))
  await db.delete(user).where(inArray(user.id, [userA, userB]))
})

describe('backfill-sending-domains', () => {
  it('adopts a domain used by a single project when it is active on the provider', async () => {
    const domain = fresh()
    await activeOnProvider(domain)
    await addInbox(projects.a, `support@${domain.toUpperCase()}`)

    const report = await runBackfill(scoped(true, projects.a), deps)
    const entry = report.entries.find((e) => e.domain === domain)

    expect(entry?.action).toBe('created')
    expect(entry?.txtRecord?.name).toBe(`_veerify-mail.${domain}`)
    expect(entry?.txtRecord?.value).toMatch(/^veerify-mail-verification=.{24,}/)
    expect(report.summary.claimsCreated).toBe(1)
    expect(report.summary.projectsNeedingDns).toBe(1)

    const [row] = (await claimsFor(projects.a)).filter((c) => c.domain === domain)
    expect(row.status).toBe('pending')
    expect(row.providerOwnership).toBe('adopted')
    expect(row.providerState).toBe('active')
    expect(row.provider).toBe('fake')
    expect(row.createdByUserId).toBe(userA) // the first admin, not the older plain member
    expect(row.nextCheckAt).toEqual(now)
    expect(row.expiresAt).toEqual(new Date(now.getTime() + 7 * 24 * 3600 * 1000))
    expect(row.dnsRecords[0]).toMatchObject({
      purpose: 'ownership',
      type: 'TXT',
      name: `_veerify-mail.${domain}`,
      value: `veerify-mail-verification=${row.ownershipToken}`,
    })
    expect(row.dnsRecords.some((r) => r.purpose === 'sending')).toBe(true)
  })

  it('reports a domain shared by several projects and assigns nothing', async () => {
    const domain = fresh()
    await activeOnProvider(domain)
    await addInbox(projects.a, `support@${domain}`)
    await addInbox(projects.b, `help@${domain}`)

    const report = await runBackfill(scoped(true, projects.a, projects.b), deps)
    const entry = report.entries.find((e) => e.domain === domain)

    expect(entry?.action).toBe('conflict_multiple_projects')
    expect(entry?.projects.map((t) => t.id).sort()).toEqual([projects.a, projects.b].sort())
    expect(report.summary.conflicts).toBeGreaterThanOrEqual(1)
    expect((await claimsFor(projects.a)).some((c) => c.domain === domain)).toBe(false)
    expect((await claimsFor(projects.b)).some((c) => c.domain === domain)).toBe(false)
  })

  it('reports a domain another project already claimed as a conflict', async () => {
    const domain = fresh()
    await activeOnProvider(domain)
    await addInbox(projects.b, `support@${domain}`)
    await db.insert(projectMailDomain).values({
      id: randomUUID(),
      projectId: projects.c,
      domain,
      registrableDomain: domain.split('.').slice(-2).join('.'),
      status: 'verified',
      provider: 'fake',
      ownershipToken: 'tok',
    })

    const report = await runBackfill(scoped(true, projects.b), deps)

    expect(report.entries.find((e) => e.domain === domain)?.action).toBe('conflict_claimed_elsewhere')
    expect((await claimsFor(projects.b)).some((c) => c.domain === domain)).toBe(false)
  })

  it('leaves an existing claim of the same project alone', async () => {
    const domain = fresh()
    await activeOnProvider(domain)
    await addInbox(projects.b, `support@${domain}`)
    const id = randomUUID()
    await db.insert(projectMailDomain).values({
      id,
      projectId: projects.b,
      domain,
      registrableDomain: domain.split('.').slice(-2).join('.'),
      status: 'verified',
      provider: 'fake',
      ownershipToken: 'tok',
    })

    const report = await runBackfill(scoped(true, projects.b), deps)
    const entry = report.entries.find((e) => e.domain === domain)

    expect(entry?.action).toBe('already_claimed')
    expect(entry?.txtRecord).toBeUndefined()
    const [row] = (await claimsFor(projects.b)).filter((c) => c.domain === domain)
    expect(row.id).toBe(id)
    expect(row.status).toBe('verified')
    expect(row.providerOwnership).toBeNull()
  })

  it('creates nothing for a domain that is not on the provider', async () => {
    const domain = fresh()
    await addInbox(projects.c, `support@${domain}`)

    const report = await runBackfill(scoped(true, projects.c), deps)
    const entry = report.entries.find((e) => e.domain === domain)

    expect(entry?.action).toBe('not_on_provider')
    expect(entry?.reason).toContain('the project must add it')
    expect((await claimsFor(projects.c)).filter((c) => c.domain === domain)).toHaveLength(0)
  })

  it('creates nothing for a domain that is on the provider but not active', async () => {
    const domain = fresh()
    await provider.register(domain) // never verified, so it stays `unverified`
    await addInbox(projects.c, `support@${domain}`)

    const report = await runBackfill(scoped(true, projects.c), deps)

    expect(report.entries.find((e) => e.domain === domain)?.action).toBe('not_active_on_provider')
    expect((await claimsFor(projects.c)).filter((c) => c.domain === domain)).toHaveLength(0)
  })

  it('claims only the parent when the same project uses a domain and its subdomain', async () => {
    const parent = fresh()
    const child = `mail.${parent}`
    await activeOnProvider(parent)
    await activeOnProvider(child)
    await addInbox(projects.c, `support@${parent}`, [`billing@${child}`])

    const report = await runBackfill(scoped(true, projects.c), deps)

    expect(report.entries.find((e) => e.domain === parent)?.action).toBe('created')
    expect(report.entries.find((e) => e.domain === child)?.action).toBe('covered_by_parent')
    expect((await claimsFor(projects.c)).map((c) => c.domain).filter((d) => d.endsWith(parent))).toEqual([parent])

    const again = await runBackfill(scoped(true, projects.c), deps)
    expect(again.summary.claimsCreated).toBe(0)
  })

  it('skips platform, reserved and invalid domains', async () => {
    process.env.SUPPORT_PLATFORM_MAIL_DOMAIN = 'platform.verify-ok.test'
    process.env.SUPPORT_SENDING_DOMAINS_RESERVED = 'reserved.verify-ok.test'
    try {
      await addInbox(projects.c, 'agent-x@inbox.platform.verify-ok.test', ['a@reserved.verify-ok.test', 'b@gmail.com'])
      const report = await runBackfill(scoped(false, projects.c), deps)
      const skipped = report.entries.filter((e) => e.action === 'skipped').map((e) => e.domain)
      expect(skipped).toEqual(
        expect.arrayContaining(['inbox.platform.verify-ok.test', 'reserved.verify-ok.test', 'gmail.com'])
      )
    } finally {
      delete process.env.SUPPORT_PLATFORM_MAIL_DOMAIN
      delete process.env.SUPPORT_SENDING_DOMAINS_RESERVED
    }
  })

  it('is idempotent: a second apply changes nothing', async () => {
    const adopt = fresh()
    const missing = fresh()
    await activeOnProvider(adopt)
    await addInbox(projects.b, `support@${adopt}`, [`sales@${missing}`])
    const before = async () =>
      (await claimsFor(projects.b)).map((c) => ({ ...c })).sort((x, y) => x.id.localeCompare(y.id))

    const first = await runBackfill(scoped(true, projects.b), deps)
    expect(first.entries.find((e) => e.domain === adopt)?.action).toBe('created')
    const afterFirst = await before()

    const second = await runBackfill(scoped(true, projects.b), deps)
    expect(second.entries.find((e) => e.domain === adopt)?.action).toBe('already_claimed')
    expect(second.entries.find((e) => e.domain === missing)?.action).toBe('not_on_provider')
    expect(second.summary.claimsCreated).toBe(0)
    expect(await before()).toEqual(afterFirst)
  })

  it('writes nothing in a dry run, yet reports what it would do', async () => {
    const domain = fresh()
    await activeOnProvider(domain)
    await addInbox(projects.c, `support@${domain}`)
    const rowsBefore = await db.select().from(projectMailDomain)

    const report = await runBackfill(scoped(false, projects.c), deps)

    expect(report.mode).toBe('dry-run')
    expect(report.entries.find((e) => e.domain === domain)?.action).toBe('would_create')
    expect(report.summary.claimsCreated).toBe(0)
    expect(report.summary.claimsWouldCreate).toBeGreaterThanOrEqual(1)
    expect(await db.select().from(projectMailDomain)).toEqual(rowsBefore)
  })
})

describe('production guard and arguments', () => {
  it('flags production-looking environments', () => {
    expect(productionDatabaseReason({ NODE_ENV: 'production' }, 'localhost')).toContain('NODE_ENV')
    expect(productionDatabaseReason({}, 'db.prod.example.com')).toContain('not local')
    expect(productionDatabaseReason({}, 'localhost')).toBeNull()
    expect(productionDatabaseReason({ PGDATABASE: 'x' }, '127.0.0.1')).toBeNull()
  })

  it('parses flags', () => {
    expect(parseArgs([])).toMatchObject({ apply: false, json: false, production: false })
    expect(
      parseArgs(['--apply', '--json', '--i-know-this-is-production', '--project', 't1', '--delay-ms=5'])
    ).toMatchObject({
      apply: true,
      json: true,
      production: true,
      projectIds: ['t1'],
      delayMs: 5,
    })
    expect(() => parseArgs(['--nope'])).toThrow()
  })
})
