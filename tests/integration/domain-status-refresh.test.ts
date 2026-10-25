import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Always the scratch database, never the shared dev or integration ones.
// Prepare it once: createdb veerify_domain_refresh && PGDATABASE=veerify_domain_refresh yarn db:migrate
vi.hoisted(() => {
  delete process.env.DATABASE_URL
  process.env.PGHOST = 'localhost'
  process.env.PGPORT = '5432'
  process.env.PGUSER = 'veerify'
  process.env.PGPASSWORD = 'veerifypassword'
  process.env.PGDATABASE = 'veerify_domain_refresh'
})

/* eslint-disable import/first -- the env must be set before the database module loads */
import { db } from '../../server/database/drizzle'
import { member, organization, user } from '../../server/database/schema/auth'
import { project, projectDomain } from '../../server/database/schema/feedback'
import type { DomainProviderResult } from '../../server/services/domains/provider'
import {
  ACTIVE_RECHECK_MS,
  PENDING_RECHECK_MS,
  createDrizzleRefreshStore,
  runDomainStatusRefresh,
} from '../../server/services/domains/status-refresh'
/* eslint-enable import/first */

const run = randomUUID().slice(0, 8)
const now = new Date('2026-10-25T12:00:00.000Z')
const orgId = `dr_org_${run}`
const users = { owner: `dr_owner_${run}`, admin: `dr_admin_${run}`, member: `dr_member_${run}` }
const projectIds: string[] = []
const store = createDrizzleRefreshStore()

const ago = (ms: number) => new Date(now.getTime() - ms)

async function addDomain(
  label: string,
  over: { status?: string; lastCheckedAt?: Date | null; customDomain?: string | null; settings?: object } = {}
) {
  const hostname = `${label}-${run}.acme.com`
  const projectId = `dr_project_${label}_${run}`
  projectIds.push(projectId)
  await db.insert(project).values({
    id: projectId,
    organizationId: orgId,
    slug: projectId,
    name: `Project ${label}`,
    customDomain: over.customDomain === undefined ? hostname : over.customDomain,
    settings: over.settings ?? {},
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(projectDomain).values({
    id: `dr_domain_${label}_${run}`,
    projectId,
    hostname,
    provider: 'cloudflare-saas',
    providerDomainId: `cf-${label}`,
    status: over.status ?? 'dns_required',
    lastCheckedAt: over.lastCheckedAt === undefined ? null : over.lastCheckedAt,
    createdAt: now,
    updatedAt: now,
  })
  return { hostname, projectId }
}

const cfResult = (hostname: string, status: DomainProviderResult['status']): DomainProviderResult => ({
  hostname,
  provider: 'cloudflare-saas',
  verified: status === 'active',
  status,
  dnsRecords: [{ type: 'CNAME', name: hostname, value: 'cname.veerify.io' }],
  configuredBy: 'CNAME',
  expected: 'cname.veerify.io',
  resolvedTo: [],
  message: null,
  providerDomainId: `cf-${hostname}`,
})

async function rowFor(hostname: string) {
  const [row] = await db.select().from(projectDomain).where(eq(projectDomain.hostname, hostname))
  return row
}

async function settingsFor(projectId: string) {
  const [row] = await db.select({ settings: project.settings }).from(project).where(eq(project.id, projectId))
  return (row?.settings || {}) as Record<string, unknown>
}

beforeAll(async () => {
  expect(process.env.PGDATABASE).toBe('veerify_domain_refresh')
  await db.insert(organization).values({ id: orgId, name: 'DR org', slug: `dr-${run}`, createdAt: now, updatedAt: now })
  await db.insert(user).values([
    { id: users.owner, name: 'Owner', email: `dr-owner-${run}@example.com`, createdAt: now, updatedAt: now },
    { id: users.admin, name: 'Admin', email: `dr-admin-${run}@example.com`, createdAt: now, updatedAt: now },
    { id: users.member, name: 'Member', email: `dr-member-${run}@example.com`, createdAt: now, updatedAt: now },
  ])
  await db.insert(member).values([
    { id: `dr_m_${run}_0`, organizationId: orgId, userId: users.owner, role: 'owner', createdAt: now, updatedAt: now },
    { id: `dr_m_${run}_1`, organizationId: orgId, userId: users.admin, role: 'admin', createdAt: now, updatedAt: now },
    {
      id: `dr_m_${run}_2`,
      organizationId: orgId,
      userId: users.member,
      role: 'member',
      createdAt: now,
      updatedAt: now,
    },
  ])
})

afterAll(async () => {
  await db.delete(project).where(inArray(project.id, projectIds))
  await db.delete(organization).where(eq(organization.id, orgId))
  await db.delete(user).where(inArray(user.id, Object.values(users)))
})

describe('domain status refresh store', () => {
  it('lists only current domains that are due, never-checked first', async () => {
    const never = await addDomain('never')
    const pendingDue = await addDomain('pending-due', { lastCheckedAt: ago(PENDING_RECHECK_MS + 1000) })
    const pendingFresh = await addDomain('pending-fresh', { lastCheckedAt: ago(60_000) })
    const activeDue = await addDomain('active-due', { status: 'active', lastCheckedAt: ago(ACTIVE_RECHECK_MS + 1000) })
    const activeFresh = await addDomain('active-fresh', {
      status: 'active',
      lastCheckedAt: ago(PENDING_RECHECK_MS + 1000),
    })
    const detached = await addDomain('detached', { status: 'detached' })
    const movedAway = await addDomain('moved-away', { customDomain: null })

    const hostnames = (await store.listDue(now, 100)).map((d) => d.hostname)
    const ours = hostnames.filter((h) => h.endsWith(`-${run}.acme.com`))

    expect(ours[0]).toBe(never.hostname)
    expect(ours).toEqual(expect.arrayContaining([pendingDue.hostname, activeDue.hostname]))
    for (const skipped of [pendingFresh, activeFresh, detached, movedAway]) {
      expect(ours).not.toContain(skipped.hostname)
    }
  })

  it('activates a domain, keeps email flags, and notifies only the owners and admins once', async () => {
    const { hostname, projectId } = await addDomain('goes-live', {
      lastCheckedAt: ago(PENDING_RECHECK_MS + 1000),
      settings: { domainConnectedEmailSentFor: 'goes-live', other: 'kept' },
    })
    const sendVerifiedEmail = vi.fn(async () => ({ success: true }) as never)
    const provider = {
      isZoneHostname: async () => false,
      lookupProjectDomain: async ({ hostname: h }: { hostname: string }) =>
        h === hostname ? cfResult(h, 'active') : cfResult(h, 'dns_required'),
    }

    await runDomainStatusRefresh({ provider, store, sendVerifiedEmail, now, limit: 100 })

    const row = await rowFor(hostname)
    expect(row).toMatchObject({ status: 'active', providerDomainId: `cf-${hostname}`, errorMessage: null })
    expect(row?.activatedAt?.toISOString()).toBe(now.toISOString())
    expect(row?.lastCheckedAt?.toISOString()).toBe(now.toISOString())

    const settings = await settingsFor(projectId)
    expect(settings).toMatchObject({
      other: 'kept',
      domainConnectedEmailSentFor: 'goes-live',
      domainStatus: 'active',
      domainProvider: 'cloudflare-saas',
      domainVerifiedEmailSentFor: hostname,
    })

    const ourEmails = (sendVerifiedEmail.mock.calls as unknown as Array<[{ to: string; domain: string }]>)
      .map(([o]) => o)
      .filter((o) => o.domain === hostname)
    expect(ourEmails.map((o) => o.to).sort()).toEqual([`dr-admin-${run}@example.com`, `dr-owner-${run}@example.com`])

    // A later check (6h on) does not email again or move activatedAt.
    const later = new Date(now.getTime() + ACTIVE_RECHECK_MS + 1000)
    sendVerifiedEmail.mockClear()
    await runDomainStatusRefresh({ provider, store, sendVerifiedEmail, now: later, limit: 100 })
    expect(
      sendVerifiedEmail.mock.calls.filter((c) => (c as unknown as [{ domain: string }])[0].domain === hostname)
    ).toEqual([])
    expect((await rowFor(hostname))?.activatedAt?.toISOString()).toBe(now.toISOString())
  })

  it('does not overwrite a domain the project moved away from during the run', async () => {
    const { hostname, projectId } = await addDomain('switched')
    const [due] = (await store.listDue(now, 100)).filter((d) => d.hostname === hostname)
    await db.update(project).set({ customDomain: null }).where(eq(project.id, projectId))

    expect(await store.apply(due!, cfResult(hostname, 'active'), now)).toBe(false)
    expect((await rowFor(hostname))?.status).toBe('dns_required')
  })

  it('touch only moves the check time', async () => {
    const { hostname } = await addDomain('touched', { status: 'active', lastCheckedAt: ago(ACTIVE_RECHECK_MS * 2) })
    const [due] = (await store.listDue(now, 100)).filter((d) => d.hostname === hostname)
    await store.touch(due!, now)
    const row = await rowFor(hostname)
    expect(row?.status).toBe('active')
    expect(row?.lastCheckedAt?.toISOString()).toBe(now.toISOString())
  })
})
