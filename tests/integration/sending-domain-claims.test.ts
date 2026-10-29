import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, user } from '../../server/database/schema/auth'
import { project } from '../../server/database/schema/feedback'
import { projectMailDomain } from '../../server/database/schema/support'
import { mailEntitlement } from '../../server/database/schema/mail'
import { getMailUsage } from '../../server/utils/mail-limits'
import {
  createSendingDomainClaim,
  getProjectSendingDomain,
  listProjectSendingDomains,
  toSendingDomainView,
} from '../../server/utils/sending-domains'

const now = new Date('2026-10-22T12:00:00.000Z')
const run = randomUUID().slice(0, 8)
const ids = {
  org: `sdc_org_${run}`,
  projectA: `sdc_project_a_${run}`,
  projectB: `sdc_project_b_${run}`,
  projectC: `sdc_project_c_${run}`,
  user: `sdc_user_${run}`,
}
const provider = { provider: 'mailgun', providerAccountKey: 'acct-1' }
const savedEnv = { ...process.env }

/** A fresh registrable domain per test, so rows from other tests never interfere. */
const fresh = () => `c${randomUUID().replace(/-/g, '').slice(0, 12)}.com`

function claim(projectId: string, domain: string, extra: Partial<Parameters<typeof createSendingDomainClaim>[0]> = {}) {
  return createSendingDomainClaim({ projectId, domain, userId: ids.user, ...provider, now, ...extra })
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

async function setTier(organizationId: string, tier: 'standard' | 'owner') {
  await db
    .insert(mailEntitlement)
    .values({ id: randomUUID(), organizationId, tier, updatedBy: 'test' })
    .onConflictDoUpdate({ target: mailEntitlement.organizationId, set: { tier } })
}

beforeAll(async () => {
  process.env.SUPPORT_SENDING_DOMAINS_ENABLED = 'true'
  await db
    .insert(user)
    .values({ id: ids.user, name: 'SDC admin', email: `sdc-${run}@example.com`, createdAt: now, updatedAt: now })
})

// A fresh workspace (with three projects) per test: the workspace mail limits
// would otherwise leak between tests. On the `owner` tier unless a test says
// otherwise, so tests about claim rules are not stopped by the domain limit.
const createdProjects: string[] = []
const createdOrgs: string[] = []
beforeEach(async () => {
  const n = createdProjects.length
  ids.org = `sdc_org_${run}_${n}`
  createdOrgs.push(ids.org)
  await db
    .insert(organization)
    .values({ id: ids.org, name: 'SDC org', slug: `sdc-${run}-${n}`, createdAt: now, updatedAt: now })
  await setTier(ids.org, 'owner')
  ids.projectA = `sdc_project_a_${run}_${n}`
  ids.projectB = `sdc_project_b_${run}_${n}`
  ids.projectC = `sdc_project_c_${run}_${n}`
  const projectIds = [ids.projectA, ids.projectB, ids.projectC]
  createdProjects.push(...projectIds)
  await db
    .insert(project)
    .values(
      projectIds.map((id) => ({ id, name: id, slug: id, organizationId: ids.org, createdAt: now, updatedAt: now }))
    )
})

afterAll(async () => {
  process.env = savedEnv
  await db.delete(project).where(inArray(project.id, createdProjects))
  await db.delete(organization).where(inArray(organization.id, createdOrgs))
  await db.delete(user).where(eq(user.id, ids.user))
})

describe('createSendingDomainClaim', () => {
  it('inserts a provisioning claim with an ownership token and TXT record', async () => {
    const domain = fresh()
    const row = await claim(ids.projectA, `  ${domain.toUpperCase()}. `)

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

  it('lets exactly one of two projects claim the same domain concurrently', async () => {
    const domain = fresh()
    const results = await Promise.allSettled([claim(ids.projectA, domain), claim(ids.projectB, domain)])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason.statusCode).toBe(409)
    expect(rejected.reason.data.code).toBe('DOMAIN_CLAIMED')
    const rows = await db.select().from(projectMailDomain).where(eq(projectMailDomain.domain, domain))
    expect(rows).toHaveLength(1)
  })

  it('serializes an ancestor and a descendant claimed concurrently by different projects', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const domain = fresh()
      const results = await Promise.allSettled([claim(ids.projectA, domain), claim(ids.projectB, `mail.${domain}`)])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const rows = await db.select().from(projectMailDomain).where(eq(projectMailDomain.registrableDomain, domain))
      expect(rows).toHaveLength(1)
      // Out of the way of the workspace pending limit for the next attempt.
      await db.delete(projectMailDomain).where(eq(projectMailDomain.registrableDomain, domain))
    }
  })

  it('refuses ancestors and descendants of another project claim, in any status, but not lookalikes', async () => {
    const domain = fresh()
    await claim(ids.projectA, `mail.${domain}`)

    await expectRejection(claim(ids.projectB, domain), 409, 'DOMAIN_CLAIMED')
    await expectRejection(claim(ids.projectB, `x.mail.${domain}`), 409, 'DOMAIN_CLAIMED')
    await expectRejection(claim(ids.projectB, `mail.${domain}`), 409, 'DOMAIN_CLAIMED')
    await expect(claim(ids.projectB, `bad${domain}`)).resolves.toMatchObject({ projectId: ids.projectB })
  })

  it('allows nesting within one project and rejects a duplicate', async () => {
    const domain = fresh()
    await claim(ids.projectA, domain)
    await expect(claim(ids.projectA, `mail.${domain}`)).resolves.toMatchObject({ projectId: ids.projectA })
    await expectRejection(claim(ids.projectA, domain), 409, 'DOMAIN_ALREADY_REGISTERED')
  })

  it('rejects invalid, reserved and mailbox-provider names with 422', async () => {
    process.env.APP_DOMAIN = 'app.reserved-sdc.com'
    process.env.SUPPORT_SENDING_DOMAINS_RESERVED = 'extra-sdc.org, other-sdc.org'
    try {
      await expectRejection(claim(ids.projectC, 'not a domain'), 422, 'DOMAIN_REJECTED')
      await expectRejection(claim(ids.projectC, '10.0.0.1'), 422, 'DOMAIN_REJECTED')
      await expectRejection(claim(ids.projectC, 'gmail.com'), 422, 'DOMAIN_REJECTED')
      await expectRejection(claim(ids.projectC, 'reserved-sdc.com'), 422, 'DOMAIN_REJECTED')
      await expectRejection(claim(ids.projectC, 'x.app.reserved-sdc.com'), 422, 'DOMAIN_REJECTED')
      await expectRejection(claim(ids.projectC, 'mail.extra-sdc.org'), 422, 'DOMAIN_REJECTED')
      await expectRejection(claim(ids.projectC, 'acme.verify-ok.test'), 422, 'DOMAIN_REJECTED')
      await expect(claim(ids.projectC, 'acme.verify-ok.test', { provider: 'fake' })).resolves.toMatchObject({
        registrableDomain: 'verify-ok.test',
      })
    } finally {
      delete process.env.APP_DOMAIN
      delete process.env.SUPPORT_SENDING_DOMAINS_RESERVED
      await db.delete(projectMailDomain).where(eq(projectMailDomain.projectId, ids.projectC))
    }
  })

  it('enforces the workspace pending limit across projects; verified claims do not count against it', async () => {
    // Owner tier: 69 domains, but still at most 3 waiting for verification per workspace.
    const created = [await claim(ids.projectA, fresh()), await claim(ids.projectB, fresh())]
    created.push(await claim(ids.projectC, fresh()))
    await expectRejection(claim(ids.projectA, fresh()), 409, 'MAIL_PENDING_LIMIT_REACHED')

    await db
      .update(projectMailDomain)
      .set({ status: 'verified' })
      .where(
        inArray(
          projectMailDomain.id,
          created.map((row) => row.id)
        )
      )
    await expect(claim(ids.projectB, fresh())).resolves.toMatchObject({ status: 'provisioning' })
  })

  it('enforces the workspace domain limit across two projects and does not count claims being deleted', async () => {
    await setTier(ids.org, 'standard')
    // Standard tier: 3 domains per workspace, spread over two of its projects.
    const first = await claim(ids.projectA, fresh())
    await claim(ids.projectA, fresh())
    await claim(ids.projectB, fresh())
    await db.update(projectMailDomain).set({ status: 'verified' }).where(eq(projectMailDomain.id, first.id))

    await expectRejection(claim(ids.projectB, fresh()), 409, 'MAIL_DOMAIN_LIMIT_REACHED')
    await expectRejection(claim(ids.projectC, fresh()), 409, 'MAIL_DOMAIN_LIMIT_REACHED')
    const usage = await getMailUsage(ids.org)
    expect(usage).toMatchObject({ tier: 'standard', used: { domains: 3, pendingDomains: 2 } })

    // A claim being deleted no longer counts.
    await db.update(projectMailDomain).set({ status: 'deleting' }).where(eq(projectMailDomain.id, first.id))
    await expect(claim(ids.projectC, fresh())).resolves.toMatchObject({ projectId: ids.projectC })
    await expectRejection(claim(ids.projectA, fresh()), 409, 'MAIL_DOMAIN_LIMIT_REACHED')
  })

  it('serializes concurrent claims in different projects of one workspace against the limit', async () => {
    await setTier(ids.org, 'standard')
    const projects = [ids.projectA, ids.projectB, ids.projectC]
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => claim(projects[i % 3], fresh())))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3)
    for (const rejected of results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')) {
      expect(rejected.reason.data.code).toBe('MAIL_DOMAIN_LIMIT_REACHED')
    }
    const rows = await db.select().from(projectMailDomain).where(inArray(projectMailDomain.projectId, projects))
    expect(rows).toHaveLength(3)
  })

  it('counts each workspace on its own', async () => {
    await setTier(ids.org, 'standard')
    for (let i = 0; i < 3; i++) await claim(ids.projectA, fresh())
    await expectRejection(claim(ids.projectB, fresh()), 409, 'MAIL_DOMAIN_LIMIT_REACHED')

    const otherOrg = `sdc_org_other_${run}_${createdOrgs.length}`
    const otherProject = `sdc_project_other_${run}_${createdOrgs.length}`
    createdOrgs.push(otherOrg)
    createdProjects.push(otherProject)
    await db.insert(organization).values({
      id: otherOrg,
      name: 'Other',
      slug: `sdc-other-${run}-${createdOrgs.length}`,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(project).values({
      id: otherProject,
      name: 'o',
      slug: otherProject,
      organizationId: otherOrg,
      createdAt: now,
      updatedAt: now,
    })
    await expect(claim(otherProject, fresh())).resolves.toMatchObject({ projectId: otherProject })
  })
})

describe('project-scoped reads', () => {
  it('lists only the project claims and returns 404 across projects', async () => {
    const domain = fresh()
    const row = await claim(ids.projectA, domain)

    expect((await listProjectSendingDomains(ids.projectA)).some((r) => r.id === row.id)).toBe(true)
    expect((await listProjectSendingDomains(ids.projectB)).some((r) => r.id === row.id)).toBe(false)
    await expect(getProjectSendingDomain(ids.projectA, row.id)).resolves.toMatchObject({ domain })
    await expect(getProjectSendingDomain(ids.projectB, row.id)).rejects.toMatchObject({ statusCode: 404 })
    await expect(getProjectSendingDomain(ids.projectA, randomUUID())).rejects.toMatchObject({ statusCode: 404 })
  })

  it('maps a row to a view and flags a provider mismatch', async () => {
    const row = await claim(ids.projectA, fresh())

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
