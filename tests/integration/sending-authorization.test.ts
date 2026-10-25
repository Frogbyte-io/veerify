import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization } from '../../server/database/schema/auth'
import { project } from '../../server/database/schema/feedback'
import { supportInbox, supportInboxAddress, supportSendingDomain } from '../../server/database/schema/support'
import {
  assertReceivingAddressAllowed,
  assertSenderAddressAllowedForInbox,
  resetSenderPolicyCache,
  resolveSenderPolicy,
  resolveProjectSenderAuthorization,
} from '../../server/utils/sending-domains'

const now = new Date('2026-10-22T12:00:00.000Z')
const run = randomUUID().slice(0, 8)
const ids = {
  org: `sda_org_${run}`,
  projectA: `sda_project_a_${run}`,
  projectB: `sda_project_b_${run}`,
  inboxA: `sda_inbox_a_${run}`,
  inboxB: `sda_inbox_b_${run}`,
}
const savedEnv = { ...process.env }
const mailgun = { name: 'mailgun', accountKey: 'acct-1', authorizesSubdomains: true }
const postmark = { name: 'postmark', accountKey: 'pm-1', authorizesSubdomains: false }
const fresh = () => `a${randomUUID().replace(/-/g, '').slice(0, 12)}.com`

async function addClaim(
  projectId: string,
  domain: string,
  status: string,
  overrides: Partial<typeof supportSendingDomain.$inferInsert> = {}
) {
  const id = randomUUID()
  await db.insert(supportSendingDomain).values({
    id,
    projectId,
    domain,
    registrableDomain: domain.split('.').slice(-2).join('.'),
    status,
    provider: 'mailgun',
    providerAccountKey: 'acct-1',
    ownershipToken: 'tok',
    ...overrides,
  })
  return id
}

const verdict = (projectId: string, address: string, provider = mailgun) =>
  resolveProjectSenderAuthorization(projectId, address, { provider })

beforeAll(async () => {
  process.env.SUPPORT_SENDING_DOMAINS_ENABLED = 'true'
  process.env.SUPPORT_CHANNEL_PROVIDER = 'mailgun'
  process.env.SUPPORT_MAILGUN_ACCOUNT_KEY = 'acct-1'
  delete process.env.SUPPORT_SENDING_DOMAIN_PROVIDER
  await db
    .insert(organization)
    .values({ id: ids.org, name: 'SDA org', slug: `sda-${run}`, createdAt: now, updatedAt: now })
  await db.insert(project).values(
    [ids.projectA, ids.projectB].map((id) => ({
      id,
      name: id,
      slug: id,
      organizationId: ids.org,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(supportInbox).values(
    [
      { id: ids.inboxA, projectId: ids.projectA },
      { id: ids.inboxB, projectId: ids.projectB },
    ].map(({ id, projectId }) => ({
      id,
      projectId,
      name: id,
      slug: id,
      emailAddress: `${id}@inbox.example.net`,
      createdAt: now,
      updatedAt: now,
    }))
  )
})

afterAll(async () => {
  process.env = savedEnv
  await db.delete(project).where(inArray(project.id, [ids.projectA, ids.projectB]))
  await db.delete(organization).where(eq(organization.id, ids.org))
})

describe('resolveSenderPolicy', () => {
  it('is project when enabled, and follows SUPPORT_SENDER_POLICY otherwise', () => {
    expect(resolveSenderPolicy()).toBe('project')
    process.env.SUPPORT_SENDER_POLICY = 'legacy'
    expect(resolveSenderPolicy()).toBe('project')
    process.env.SUPPORT_SENDING_DOMAINS_ENABLED = 'false'
    expect(resolveSenderPolicy()).toBe('legacy')
    process.env.SUPPORT_SENDER_POLICY = 'project'
    expect(resolveSenderPolicy()).toBe('project')
    delete process.env.SUPPORT_SENDER_POLICY
    process.env.SUPPORT_SENDING_DOMAINS_ENABLED = 'true'
  })
})

describe('resolveProjectSenderAuthorization', () => {
  it('authorizes the owning project and refuses another project', async () => {
    const domain = fresh()
    const id = await addClaim(ids.projectA, domain, 'verified')

    expect(await verdict(ids.projectA, `Support@${domain.toUpperCase()}`)).toEqual({
      status: 'authorized',
      domain: { id, domain },
    })
    const refused = await verdict(ids.projectB, `support@${domain}`)
    expect(refused).toMatchObject({ status: 'unauthorized', reason: 'not_owned' })
    expect((refused as { projectDomains: string[] }).projectDomains).not.toContain(domain)
  })

  it('lists only the caller project verified domains in an unauthorized verdict', async () => {
    const own = fresh()
    const other = fresh()
    await addClaim(ids.projectA, own, 'verified')
    await addClaim(ids.projectB, other, 'verified')

    const result = await verdict(ids.projectA, `x@${other}`)
    expect(result).toMatchObject({ status: 'unauthorized', reason: 'not_owned' })
    expect((result as { projectDomains: string[] }).projectDomains).toContain(own)
    expect((result as { projectDomains: string[] }).projectDomains).not.toContain(other)
  })

  it('covers subdomains for mailgun, but not for postmark', async () => {
    const domain = fresh()
    const pmId = await addClaim(ids.projectA, domain, 'verified', { provider: 'postmark', providerAccountKey: 'pm-1' })
    const mgId = await addClaim(ids.projectA, `mg.${domain}`, 'verified')

    expect(await verdict(ids.projectA, `x@a.mg.${domain}`)).toEqual({
      status: 'authorized',
      domain: { id: mgId, domain: `mg.${domain}` },
    })
    expect(await verdict(ids.projectA, `x@a.${domain}`, postmark)).toMatchObject({ status: 'unauthorized' })
    expect(await verdict(ids.projectA, `x@${domain}`, postmark)).toEqual({
      status: 'authorized',
      domain: { id: pmId, domain },
    })
    // label boundary
    expect(await verdict(ids.projectA, `x@bad${domain}`)).toMatchObject({ status: 'unauthorized', reason: 'not_owned' })
  })

  it('most specific verified claim wins', async () => {
    const domain = fresh()
    await addClaim(ids.projectA, domain, 'verified')
    const child = await addClaim(ids.projectA, `mail.${domain}`, 'verified')
    expect(await verdict(ids.projectA, `x@mail.${domain}`)).toMatchObject({ domain: { id: child } })
  })

  it('does not authorize pending, provisioning or failed claims, and reports them as pending', async () => {
    for (const status of ['pending', 'provisioning', 'failed']) {
      const domain = fresh()
      const id = await addClaim(ids.projectA, domain, status)
      expect(await verdict(ids.projectA, `support@${domain}`)).toEqual({
        status: 'pending',
        domain: { id, domain, status },
      })
    }
  })

  it('suspension blocks and recovery unblocks', async () => {
    const domain = fresh()
    const id = await addClaim(ids.projectA, domain, 'verified')
    expect((await verdict(ids.projectA, `s@${domain}`)).status).toBe('authorized')

    await db.update(supportSendingDomain).set({ status: 'suspended' }).where(eq(supportSendingDomain.id, id))
    expect(await verdict(ids.projectA, `s@${domain}`)).toMatchObject({ status: 'unauthorized', reason: 'suspended' })

    await db.update(supportSendingDomain).set({ status: 'verified' }).where(eq(supportSendingDomain.id, id))
    expect((await verdict(ids.projectA, `s@${domain}`)).status).toBe('authorized')
  })

  it('does not authorize a claim that is being deleted', async () => {
    const domain = fresh()
    await addClaim(ids.projectA, domain, 'deleting')
    expect(await verdict(ids.projectA, `s@${domain}`)).toMatchObject({ status: 'unauthorized', reason: 'not_owned' })
  })

  it('reports a provider mismatch instead of authorizing', async () => {
    const domain = fresh()
    await addClaim(ids.projectA, domain, 'verified', { providerAccountKey: 'old-project' })
    expect(await verdict(ids.projectA, `s@${domain}`)).toMatchObject({
      status: 'unauthorized',
      reason: 'provider_mismatch',
    })
    // A mismatched claim is never offered as a usable domain.
    const { projectDomains } = (await verdict(ids.projectA, `s@${domain}`)) as { projectDomains: string[] }
    expect(projectDomains).not.toContain(domain)
    await addClaim(ids.projectA, `other-${domain}`, 'verified', { provider: 'postmark' })
    expect(await verdict(ids.projectA, `s@other-${domain}`)).toMatchObject({ reason: 'provider_mismatch' })
  })

  it('authorizes only the project own platform addresses', async () => {
    const address = `project-a-inbox-${run}@veerifymail.example`
    await db.insert(supportInboxAddress).values({
      id: randomUUID(),
      inboxId: ids.inboxA,
      projectId: ids.projectA,
      address,
      kind: 'platform',
      createdAt: now,
    })
    expect(await verdict(ids.projectA, address)).toEqual({ status: 'authorized', domain: null, platform: true })
    expect(await verdict(ids.projectB, address)).toMatchObject({ status: 'unauthorized', reason: 'not_owned' })
    expect(await verdict(ids.projectA, `other-${run}@veerifymail.example`)).toMatchObject({ status: 'unauthorized' })
  })

  it('a custom address row is not a platform address', async () => {
    const address = `custom-${run}@forward.example.org`
    await db.insert(supportInboxAddress).values({
      id: randomUUID(),
      inboxId: ids.inboxA,
      projectId: ids.projectA,
      address,
      kind: 'custom',
      createdAt: now,
    })
    expect(await verdict(ids.projectA, address)).toMatchObject({ status: 'unauthorized' })
  })

  it('returns unknown, not unauthorized, when no domain can be read', async () => {
    expect(await verdict(ids.projectA, 'not-an-address')).toMatchObject({ status: 'unknown' })
  })

  it('reads through a supplied executor (transaction)', async () => {
    const domain = fresh()
    const id = await addClaim(ids.projectA, domain, 'verified')
    const result = await db.transaction((tx) =>
      resolveProjectSenderAuthorization(ids.projectA, `x@${domain}`, { executor: tx, provider: mailgun })
    )
    expect(result).toEqual({ status: 'authorized', domain: { id, domain } })
  })
})

describe('assertSenderAddressAllowedForInbox', () => {
  it('allows own claims in any live status and platform addresses', async () => {
    const pending = fresh()
    await addClaim(ids.projectA, pending, 'pending')
    await expect(assertSenderAddressAllowedForInbox(ids.projectA, `support@${pending}`)).resolves.toBeUndefined()
    await expect(assertSenderAddressAllowedForInbox(ids.projectA, `support@x.${pending}`)).resolves.toBeUndefined()
    await expect(
      assertSenderAddressAllowedForInbox(ids.projectA, `project-a-inbox-${run}@veerifymail.example`)
    ).resolves.toBeUndefined()
  })

  it('rejects other projects, unclaimed domains and deleting claims with 422', async () => {
    const theirs = fresh()
    const deleting = fresh()
    await addClaim(ids.projectB, theirs, 'verified')
    await addClaim(ids.projectA, deleting, 'deleting')

    for (const address of [`support@${theirs}`, `support@${fresh()}`, `support@${deleting}`, 'garbage']) {
      await expect(assertSenderAddressAllowedForInbox(ids.projectA, address)).rejects.toMatchObject({
        statusCode: 422,
        data: { code: 'SENDER_DOMAIN_NOT_OWNED' },
      })
    }
  })

  it('keeps enforcing the project policy with the flag off while claims exist (rollback is not a bypass)', async () => {
    process.env.SUPPORT_SENDING_DOMAINS_ENABLED = 'false'
    resetSenderPolicyCache()
    try {
      await expect(assertSenderAddressAllowedForInbox(ids.projectA, `support@${fresh()}`)).rejects.toMatchObject({
        statusCode: 422,
      })
    } finally {
      process.env.SUPPORT_SENDING_DOMAINS_ENABLED = 'true'
    }
  })
})

describe('assertReceivingAddressAllowed', () => {
  it('refuses addresses on or under another project claim, in any status', async () => {
    const domain = fresh()
    await addClaim(ids.projectB, domain, 'pending')

    for (const address of [`support@${domain}`, `support@help.${domain}`, `support@a.b.${domain}`]) {
      await expect(assertReceivingAddressAllowed(ids.projectA, address)).rejects.toMatchObject({
        statusCode: 409,
        data: { code: 'ADDRESS_DOMAIN_CLAIMED' },
      })
    }
    await expect(assertReceivingAddressAllowed(ids.projectB, `support@help.${domain}`)).resolves.toBeUndefined()
    await expect(assertReceivingAddressAllowed(ids.projectA, `support@bad${domain}`)).resolves.toBeUndefined()
  })

  it('allows unclaimed domains and the project own claims', async () => {
    const own = fresh()
    await addClaim(ids.projectA, own, 'verified')
    await expect(assertReceivingAddressAllowed(ids.projectA, `support@${own}`)).resolves.toBeUndefined()
    await expect(assertReceivingAddressAllowed(ids.projectA, `support@${fresh()}`)).resolves.toBeUndefined()
  })

  it('refuses hand-entered addresses on the platform domain', async () => {
    process.env.SUPPORT_PLATFORM_MAIL_DOMAIN = 'veerifymail.example'
    try {
      await expect(assertReceivingAddressAllowed(ids.projectA, 'x@veerifymail.example')).rejects.toMatchObject({
        statusCode: 422,
        data: { code: 'ADDRESS_DOMAIN_RESERVED' },
      })
      await expect(assertReceivingAddressAllowed(ids.projectA, 'x@sub.veerifymail.example')).rejects.toMatchObject({
        statusCode: 422,
      })
    } finally {
      delete process.env.SUPPORT_PLATFORM_MAIL_DOMAIN
    }
  })

  it('keeps refusing another project claim with the flag off while claims exist', async () => {
    const domain = fresh()
    await addClaim(ids.projectB, domain, 'verified')
    process.env.SUPPORT_SENDING_DOMAINS_ENABLED = 'false'
    resetSenderPolicyCache()
    try {
      await expect(assertReceivingAddressAllowed(ids.projectA, `support@${domain}`)).rejects.toMatchObject({
        statusCode: 409,
      })
    } finally {
      process.env.SUPPORT_SENDING_DOMAINS_ENABLED = 'true'
    }
  })
})
