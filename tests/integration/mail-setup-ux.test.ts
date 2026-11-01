import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { db } from '../../server/database/drizzle'
import { member, organization, user } from '../../server/database/schema/auth'
import { project, projectMember } from '../../server/database/schema/feedback'
import { projectMailDomain } from '../../server/database/schema/support'
import type { SendingDomainProvider } from '../../server/services/sending-domains/types'

const mail = vi.hoisted(() => ({
  sendMailDomainMxNeededEmail: vi.fn(async () => ({})),
  sendMailForwardingPausedEmail: vi.fn(async () => ({})),
  sendMailForwardingResumedEmail: vi.fn(async () => ({})),
}))
vi.mock('~/lib/email', () => mail)
vi.mock('~/server/services/sending-domains', () => ({ getSendingDomainProvider: () => null }))

const { syncDomainReceiving } = await import('../../server/utils/sending-domain-poller')
const { refreshExistingMxHosts } = await import('../../server/utils/mail-domain-mx')
const { listProjectAdminRecipients } = await import('../../server/utils/mail-setup-notifications')
const { enforceForwardLimit } = await import('../../server/utils/mail-forward-usage')
const { clearForwardCountCache } = await import('../../server/utils/mail-forward-count')

/** Real Postgres: migration 0071 columns, the one-time MX notice and forward pause notices. */
describe('mail setup UX (0071)', () => {
  const suffix = randomUUID().slice(0, 8)
  const orgId = `org_su_${suffix}`
  const projectId = `project_su_${suffix}`
  const users = {
    owner: `user_su_owner_${suffix}`,
    projectAdmin: `user_su_padmin_${suffix}`,
    member: `user_su_member_${suffix}`,
  }
  const NOW = new Date('2026-10-31T12:00:00Z')

  function receivingProvider(state: Record<string, unknown>): SendingDomainProvider {
    const receiving = {
      status: 'pending_mx',
      forwardingPaused: false,
      records: [
        {
          purpose: 'receiving',
          type: 'MX',
          name: `su-${suffix}.example`,
          value: 'inbound-smtp.us-east-1.amazonaws.com',
          priority: '10',
          status: 'unknown',
        },
      ],
      lastReceivedAt: null,
      ...state,
    }
    return {
      name: 'mailgun',
      accountKey: 'acct',
      capabilities: {
        register: true,
        verifyNow: true,
        remove: true,
        inboundRoutes: true,
        authorizesSubdomains: true,
        forwarding: true,
      },
      isConfigured: () => ({ configured: true, missing: [] }),
      getReceiving: async () => receiving,
      enableReceiving: async () => receiving,
      setForwardingPaused: async () => receiving,
      getDomainUsage: async () => ({
        received: 0,
        forwarded: Number(state.forwarded ?? 0),
        forwardSkipped: 0,
        blocked: 0,
      }),
    } as unknown as SendingDomainProvider
  }

  async function addClaim(overrides: Partial<typeof projectMailDomain.$inferInsert> = {}) {
    const id = `md_${randomUUID()}`
    const domain = `su-${suffix}-${id.slice(-6)}.example`
    await db.insert(projectMailDomain).values({
      id,
      projectId,
      domain,
      registrableDomain: domain,
      status: 'verified',
      provider: 'mailgun',
      providerAccountKey: 'acct',
      ownershipToken: `tok_${randomUUID()}`,
      verifiedAt: new Date(NOW.getTime() - 10 * 60_000),
      receivingStatus: 'pending_mx',
      ...overrides,
    })
    return id
  }

  const claimRow = async (id: string) =>
    (await db.select().from(projectMailDomain).where(eq(projectMailDomain.id, id)))[0]!

  const google = async () => [{ exchange: 'aspmx.l.google.com', priority: 1 }]
  const deps = {
    now: NOW,
    refreshMx: (row: Parameters<typeof refreshExistingMxHosts>[0], extra: { now?: Date } = {}) =>
      refreshExistingMxHosts(row, { ...extra, resolveMx: google }),
  }

  beforeAll(async () => {
    await db.insert(organization).values({ id: orgId, name: 'SU Org', slug: `su-org-${suffix}` })
    await db
      .insert(user)
      .values(
        Object.entries(users).map(([role, id]) => ({ id, name: role, email: `${id}@example.com`, emailVerified: true }))
      )
    await db.insert(member).values([
      { id: `m_${users.owner}`, organizationId: orgId, userId: users.owner, role: 'owner', createdAt: NOW },
      {
        id: `m_${users.projectAdmin}`,
        organizationId: orgId,
        userId: users.projectAdmin,
        role: 'member',
        createdAt: NOW,
      },
      { id: `m_${users.member}`, organizationId: orgId, userId: users.member, role: 'member', createdAt: NOW },
    ])
    await db.insert(project).values({ id: projectId, name: 'Setup UX', slug: `su-${suffix}`, organizationId: orgId })
    await db.insert(projectMember).values([
      { id: `pm_${users.projectAdmin}`, projectId, userId: users.projectAdmin, role: 'admin' },
      { id: `pm_${users.member}`, projectId, userId: users.member, role: 'member' },
    ])
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    clearForwardCountCache()
    await db.delete(projectMailDomain).where(eq(projectMailDomain.projectId, projectId))
  })

  afterAll(async () => {
    await db.delete(project).where(eq(project.id, projectId))
    await db.delete(member).where(eq(member.organizationId, orgId))
    await db.delete(user).where(inArray(user.id, Object.values(users)))
    await db.delete(organization).where(eq(organization.id, orgId))
  })

  it('lists workspace owners/admins and project admins, not plain members', async () => {
    const target = await listProjectAdminRecipients(projectId)
    expect(target?.projectName).toBe('Setup UX')
    expect(target?.recipients.map((r) => r.email).sort()).toEqual(
      [`${users.owner}@example.com`, `${users.projectAdmin}@example.com`].sort()
    )
  })

  it('stores existing MX hosts and sends the "one more DNS record" notice exactly once', async () => {
    const id = await addClaim()
    const provider = receivingProvider({})

    await syncDomainReceiving(await claimRow(id), provider, deps)
    let row = await claimRow(id)
    expect(row.existingMxHosts).toEqual(['aspmx.l.google.com'])
    expect(row.existingMxCheckedAt).toEqual(NOW)
    expect(row.mxNoticeSentAt).toEqual(NOW)
    expect(mail.sendMailDomainMxNeededEmail).toHaveBeenCalledTimes(2)
    expect(mail.sendMailDomainMxNeededEmail).toHaveBeenCalledWith(
      expect.objectContaining({ existingMxHosts: ['aspmx.l.google.com'], domain: row.domain })
    )

    // A second pass, and a stale row that still says "not sent", both send nothing.
    await syncDomainReceiving(await claimRow(id), provider, deps)
    await syncDomainReceiving({ ...(await claimRow(id)), mxNoticeSentAt: null }, provider, deps)
    expect(mail.sendMailDomainMxNeededEmail).toHaveBeenCalledTimes(2)
    row = await claimRow(id)
    expect(row.mxNoticeSentAt).toEqual(NOW)
  })

  it('stores last_received_at once receiving is active and stops looking up MX hosts', async () => {
    const id = await addClaim({ receivingStatus: 'active', existingMxHosts: ['old.mx.example'] })
    const received = new Date('2026-10-31T09:30:00Z')
    await syncDomainReceiving(
      await claimRow(id),
      receivingProvider({ status: 'active', lastReceivedAt: received }),
      deps
    )
    const row = await claimRow(id)
    expect(row.lastReceivedAt).toEqual(received)
    expect(row.receivingStatus).toBe('active')
    expect(row.existingMxHosts).toEqual(['old.mx.example'])
    expect(mail.sendMailDomainMxNeededEmail).not.toHaveBeenCalled()
  })

  it('pauses and resumes forwarding with one notice per change', async () => {
    const id = await addClaim({ receivingStatus: 'active' })
    await enforceForwardLimit(receivingProvider({ status: 'active', forwarded: 5000 }), orgId, NOW)
    expect((await claimRow(id)).forwardingPausedAt).toEqual(NOW)
    expect(mail.sendMailForwardingPausedEmail).toHaveBeenCalledTimes(2)

    // Still over the limit: nothing changes, nothing is sent.
    await enforceForwardLimit(receivingProvider({ status: 'active', forwarded: 6000 }), orgId, NOW)
    expect(mail.sendMailForwardingPausedEmail).toHaveBeenCalledTimes(2)

    await enforceForwardLimit(receivingProvider({ status: 'active', forwarded: 0 }), orgId, NOW)
    expect((await claimRow(id)).forwardingPausedAt).toBeNull()
    expect(mail.sendMailForwardingResumedEmail).toHaveBeenCalledTimes(2)
  })
})
