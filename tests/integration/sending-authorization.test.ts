import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { db } from '../../server/database/drizzle'
import { organization, team } from '../../server/database/schema/auth'
import { supportInbox, supportInboxAddress, supportSendingDomain } from '../../server/database/schema/support'
import {
  assertReceivingAddressAllowed,
  assertSenderAddressAllowedForInbox,
  resolveSenderPolicy,
  resolveTeamSenderAuthorization,
} from '../../server/utils/sending-domains'

const now = new Date('2026-10-22T12:00:00.000Z')
const run = randomUUID().slice(0, 8)
const ids = {
  org: `sda_org_${run}`,
  teamA: `sda_team_a_${run}`,
  teamB: `sda_team_b_${run}`,
  inboxA: `sda_inbox_a_${run}`,
  inboxB: `sda_inbox_b_${run}`,
}
const savedEnv = { ...process.env }
const mailgun = { name: 'mailgun', accountKey: 'acct-1', authorizesSubdomains: true }
const postmark = { name: 'postmark', accountKey: 'pm-1', authorizesSubdomains: false }
const fresh = () => `a${randomUUID().replace(/-/g, '').slice(0, 12)}.com`

async function addClaim(
  teamId: string,
  domain: string,
  status: string,
  overrides: Partial<typeof supportSendingDomain.$inferInsert> = {}
) {
  const id = randomUUID()
  await db.insert(supportSendingDomain).values({
    id,
    teamId,
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

const verdict = (teamId: string, address: string, provider = mailgun) =>
  resolveTeamSenderAuthorization(teamId, address, { provider })

beforeAll(async () => {
  process.env.SUPPORT_SENDING_DOMAINS_ENABLED = 'true'
  process.env.SUPPORT_CHANNEL_PROVIDER = 'mailgun'
  process.env.SUPPORT_MAILGUN_ACCOUNT_KEY = 'acct-1'
  delete process.env.SUPPORT_SENDING_DOMAIN_PROVIDER
  await db
    .insert(organization)
    .values({ id: ids.org, name: 'SDA org', slug: `sda-${run}`, createdAt: now, updatedAt: now })
  await db.insert(team).values(
    [ids.teamA, ids.teamB].map((id) => ({
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
      { id: ids.inboxA, teamId: ids.teamA },
      { id: ids.inboxB, teamId: ids.teamB },
    ].map(({ id, teamId }) => ({
      id,
      teamId,
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
  await db.delete(team).where(inArray(team.id, [ids.teamA, ids.teamB]))
  await db.delete(organization).where(eq(organization.id, ids.org))
})

describe('resolveSenderPolicy', () => {
  it('is team when enabled, and follows SUPPORT_SENDER_POLICY otherwise', () => {
    expect(resolveSenderPolicy()).toBe('team')
    process.env.SUPPORT_SENDER_POLICY = 'legacy'
    expect(resolveSenderPolicy()).toBe('team')
    process.env.SUPPORT_SENDING_DOMAINS_ENABLED = 'false'
    expect(resolveSenderPolicy()).toBe('legacy')
    process.env.SUPPORT_SENDER_POLICY = 'team'
    expect(resolveSenderPolicy()).toBe('team')
    delete process.env.SUPPORT_SENDER_POLICY
    process.env.SUPPORT_SENDING_DOMAINS_ENABLED = 'true'
  })
})

describe('resolveTeamSenderAuthorization', () => {
  it('authorizes the owning team and refuses another team', async () => {
    const domain = fresh()
    const id = await addClaim(ids.teamA, domain, 'verified')

    expect(await verdict(ids.teamA, `Support@${domain.toUpperCase()}`)).toEqual({
      status: 'authorized',
      domain: { id, domain },
    })
    const refused = await verdict(ids.teamB, `support@${domain}`)
    expect(refused).toMatchObject({ status: 'unauthorized', reason: 'not_owned' })
    expect((refused as { teamDomains: string[] }).teamDomains).not.toContain(domain)
  })

  it('lists only the caller team verified domains in an unauthorized verdict', async () => {
    const own = fresh()
    const other = fresh()
    await addClaim(ids.teamA, own, 'verified')
    await addClaim(ids.teamB, other, 'verified')

    const result = await verdict(ids.teamA, `x@${other}`)
    expect(result).toMatchObject({ status: 'unauthorized', reason: 'not_owned' })
    expect((result as { teamDomains: string[] }).teamDomains).toContain(own)
    expect((result as { teamDomains: string[] }).teamDomains).not.toContain(other)
  })

  it('covers subdomains for mailgun, but not for postmark', async () => {
    const domain = fresh()
    const pmId = await addClaim(ids.teamA, domain, 'verified', { provider: 'postmark', providerAccountKey: 'pm-1' })
    const mgId = await addClaim(ids.teamA, `mg.${domain}`, 'verified')

    expect(await verdict(ids.teamA, `x@a.mg.${domain}`)).toEqual({
      status: 'authorized',
      domain: { id: mgId, domain: `mg.${domain}` },
    })
    expect(await verdict(ids.teamA, `x@a.${domain}`, postmark)).toMatchObject({ status: 'unauthorized' })
    expect(await verdict(ids.teamA, `x@${domain}`, postmark)).toEqual({
      status: 'authorized',
      domain: { id: pmId, domain },
    })
    // label boundary
    expect(await verdict(ids.teamA, `x@bad${domain}`)).toMatchObject({ status: 'unauthorized', reason: 'not_owned' })
  })

  it('most specific verified claim wins', async () => {
    const domain = fresh()
    await addClaim(ids.teamA, domain, 'verified')
    const child = await addClaim(ids.teamA, `mail.${domain}`, 'verified')
    expect(await verdict(ids.teamA, `x@mail.${domain}`)).toMatchObject({ domain: { id: child } })
  })

  it('does not authorize pending, provisioning or failed claims, and reports them as pending', async () => {
    for (const status of ['pending', 'provisioning', 'failed']) {
      const domain = fresh()
      const id = await addClaim(ids.teamA, domain, status)
      expect(await verdict(ids.teamA, `support@${domain}`)).toEqual({
        status: 'pending',
        domain: { id, domain, status },
      })
    }
  })

  it('suspension blocks and recovery unblocks', async () => {
    const domain = fresh()
    const id = await addClaim(ids.teamA, domain, 'verified')
    expect((await verdict(ids.teamA, `s@${domain}`)).status).toBe('authorized')

    await db.update(supportSendingDomain).set({ status: 'suspended' }).where(eq(supportSendingDomain.id, id))
    expect(await verdict(ids.teamA, `s@${domain}`)).toMatchObject({ status: 'unauthorized', reason: 'suspended' })

    await db.update(supportSendingDomain).set({ status: 'verified' }).where(eq(supportSendingDomain.id, id))
    expect((await verdict(ids.teamA, `s@${domain}`)).status).toBe('authorized')
  })

  it('does not authorize a claim that is being deleted', async () => {
    const domain = fresh()
    await addClaim(ids.teamA, domain, 'deleting')
    expect(await verdict(ids.teamA, `s@${domain}`)).toMatchObject({ status: 'unauthorized', reason: 'not_owned' })
  })

  it('reports a provider mismatch instead of authorizing', async () => {
    const domain = fresh()
    await addClaim(ids.teamA, domain, 'verified', { providerAccountKey: 'old-project' })
    expect(await verdict(ids.teamA, `s@${domain}`)).toMatchObject({
      status: 'unauthorized',
      reason: 'provider_mismatch',
    })
    // A mismatched claim is never offered as a usable domain.
    const { teamDomains } = (await verdict(ids.teamA, `s@${domain}`)) as { teamDomains: string[] }
    expect(teamDomains).not.toContain(domain)
    await addClaim(ids.teamA, `other-${domain}`, 'verified', { provider: 'postmark' })
    expect(await verdict(ids.teamA, `s@other-${domain}`)).toMatchObject({ reason: 'provider_mismatch' })
  })

  it('authorizes only the team own platform addresses', async () => {
    const address = `team-a-inbox-${run}@veerifymail.example`
    await db.insert(supportInboxAddress).values({
      id: randomUUID(),
      inboxId: ids.inboxA,
      address,
      kind: 'platform',
      createdAt: now,
    })
    expect(await verdict(ids.teamA, address)).toEqual({ status: 'authorized', domain: null, platform: true })
    expect(await verdict(ids.teamB, address)).toMatchObject({ status: 'unauthorized', reason: 'not_owned' })
    expect(await verdict(ids.teamA, `other-${run}@veerifymail.example`)).toMatchObject({ status: 'unauthorized' })
  })

  it('a custom address row is not a platform address', async () => {
    const address = `custom-${run}@forward.example.org`
    await db.insert(supportInboxAddress).values({
      id: randomUUID(),
      inboxId: ids.inboxA,
      address,
      kind: 'custom',
      createdAt: now,
    })
    expect(await verdict(ids.teamA, address)).toMatchObject({ status: 'unauthorized' })
  })

  it('returns unknown, not unauthorized, when no domain can be read', async () => {
    expect(await verdict(ids.teamA, 'not-an-address')).toMatchObject({ status: 'unknown' })
  })

  it('reads through a supplied executor (transaction)', async () => {
    const domain = fresh()
    const id = await addClaim(ids.teamA, domain, 'verified')
    const result = await db.transaction((tx) =>
      resolveTeamSenderAuthorization(ids.teamA, `x@${domain}`, { executor: tx, provider: mailgun })
    )
    expect(result).toEqual({ status: 'authorized', domain: { id, domain } })
  })
})

describe('assertSenderAddressAllowedForInbox', () => {
  it('allows own claims in any live status and platform addresses', async () => {
    const pending = fresh()
    await addClaim(ids.teamA, pending, 'pending')
    await expect(assertSenderAddressAllowedForInbox(ids.teamA, `support@${pending}`)).resolves.toBeUndefined()
    await expect(assertSenderAddressAllowedForInbox(ids.teamA, `support@x.${pending}`)).resolves.toBeUndefined()
    await expect(
      assertSenderAddressAllowedForInbox(ids.teamA, `team-a-inbox-${run}@veerifymail.example`)
    ).resolves.toBeUndefined()
  })

  it('rejects other teams, unclaimed domains and deleting claims with 422', async () => {
    const theirs = fresh()
    const deleting = fresh()
    await addClaim(ids.teamB, theirs, 'verified')
    await addClaim(ids.teamA, deleting, 'deleting')

    for (const address of [`support@${theirs}`, `support@${fresh()}`, `support@${deleting}`, 'garbage']) {
      await expect(assertSenderAddressAllowedForInbox(ids.teamA, address)).rejects.toMatchObject({
        statusCode: 422,
        data: { code: 'SENDER_DOMAIN_NOT_OWNED' },
      })
    }
  })

  it('is a no-op under the legacy policy', async () => {
    process.env.SUPPORT_SENDING_DOMAINS_ENABLED = 'false'
    try {
      await expect(assertSenderAddressAllowedForInbox(ids.teamA, `support@${fresh()}`)).resolves.toBeUndefined()
    } finally {
      process.env.SUPPORT_SENDING_DOMAINS_ENABLED = 'true'
    }
  })
})

describe('assertReceivingAddressAllowed', () => {
  it('refuses addresses on or under another team claim, in any status', async () => {
    const domain = fresh()
    await addClaim(ids.teamB, domain, 'pending')

    for (const address of [`support@${domain}`, `support@help.${domain}`, `support@a.b.${domain}`]) {
      await expect(assertReceivingAddressAllowed(ids.teamA, address)).rejects.toMatchObject({
        statusCode: 409,
        data: { code: 'ADDRESS_DOMAIN_CLAIMED' },
      })
    }
    await expect(assertReceivingAddressAllowed(ids.teamB, `support@help.${domain}`)).resolves.toBeUndefined()
    await expect(assertReceivingAddressAllowed(ids.teamA, `support@bad${domain}`)).resolves.toBeUndefined()
  })

  it('allows unclaimed domains and the team own claims', async () => {
    const own = fresh()
    await addClaim(ids.teamA, own, 'verified')
    await expect(assertReceivingAddressAllowed(ids.teamA, `support@${own}`)).resolves.toBeUndefined()
    await expect(assertReceivingAddressAllowed(ids.teamA, `support@${fresh()}`)).resolves.toBeUndefined()
  })

  it('refuses hand-entered addresses on the platform domain', async () => {
    process.env.SUPPORT_PLATFORM_MAIL_DOMAIN = 'veerifymail.example'
    try {
      await expect(assertReceivingAddressAllowed(ids.teamA, 'x@veerifymail.example')).rejects.toMatchObject({
        statusCode: 422,
        data: { code: 'ADDRESS_DOMAIN_RESERVED' },
      })
      await expect(assertReceivingAddressAllowed(ids.teamA, 'x@sub.veerifymail.example')).rejects.toMatchObject({
        statusCode: 422,
      })
    } finally {
      delete process.env.SUPPORT_PLATFORM_MAIL_DOMAIN
    }
  })

  it('is a no-op under the legacy policy', async () => {
    const domain = fresh()
    await addClaim(ids.teamB, domain, 'verified')
    process.env.SUPPORT_SENDING_DOMAINS_ENABLED = 'false'
    try {
      await expect(assertReceivingAddressAllowed(ids.teamA, `support@${domain}`)).resolves.toBeUndefined()
    } finally {
      process.env.SUPPORT_SENDING_DOMAINS_ENABLED = 'true'
    }
  })
})
