import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `requireContactAccess` is a thin database wrapper, so there is no pure core to
 * inject into (unlike `authorizeChannelWith` in realtime-channels). The drizzle
 * fluent chain is stubbed instead, with each `select()` returning the next
 * queued result.
 */
const queued: unknown[][] = []

function queueResult(rows: unknown[]) {
  queued.push(rows)
}

vi.mock('~/server/database/drizzle', () => {
  const chain = () => {
    const result = queued.shift() ?? []
    const thenable = {
      from: () => thenable,
      innerJoin: () => thenable,
      where: () => thenable,
      limit: () => Promise.resolve(result),
      then: (...callbacks: unknown[]) =>
        // eslint-disable-next-line no-unused-vars
        Promise.resolve(result).then(callbacks[0] as (...args: [unknown[]]) => unknown),
    }
    return thenable
  }
  return { db: { select: chain } }
})

const {
  requireContactAccess,
  requireCompanyAccess,
  requireTeamMembership,
  requireInboxAccess,
  requireInboxRole,
  requireTeamAdmin,
  requireSupportTeamRole,
  capabilitiesForRole,
  requireConversationAccess,
  resolveInboxByAddress,
} = await import('~/server/utils/support-access')

async function expectStatus(promise: Promise<unknown>, statusCode: number) {
  await expect(promise).rejects.toMatchObject({ statusCode })
}

beforeEach(() => {
  queued.length = 0
})

describe('requireContactAccess', () => {
  it('returns the contact when the user is a member of its team', async () => {
    queueResult([{ id: 'c1', teamId: 't1', email: 'a@example.com' }])
    queueResult([{ id: 'm1', role: 'member' }])

    await expect(requireContactAccess('c1', 'u1')).resolves.toMatchObject({ id: 'c1', teamId: 't1' })
  })

  it('throws 404 when the contact does not exist', async () => {
    queueResult([])

    await expectStatus(requireContactAccess('missing', 'u1'), 404)
  })

  it('throws 403 when the contact exists but the user is not in its team', async () => {
    // The distinction matters: 404 means "no such contact", 403 means "exists,
    // not yours". Collapsing them would hide cross-tenant access attempts.
    queueResult([{ id: 'c1', teamId: 't1' }])
    queueResult([])

    await expectStatus(requireContactAccess('c1', 'outsider'), 403)
  })

  it('does not check membership when the contact is missing', async () => {
    // Only one query is queued. If the implementation ran the membership query
    // anyway it would read an empty queue and wrongly resolve.
    queueResult([])

    await expectStatus(requireContactAccess('missing', 'u1'), 404)
    expect(queued.length).toBe(0)
  })
})

describe('requireCompanyAccess', () => {
  it('returns the company when the user is a member of its team', async () => {
    queueResult([{ id: 'co1', teamId: 't1', name: 'Acme' }])
    queueResult([{ id: 'm1', role: 'member' }])

    await expect(requireCompanyAccess('co1', 'u1')).resolves.toMatchObject({ id: 'co1', teamId: 't1' })
  })

  it('throws 404 when the company does not exist', async () => {
    queueResult([])

    await expectStatus(requireCompanyAccess('missing', 'u1'), 404)
  })

  it('throws 403 when the company exists but the user is not in its team', async () => {
    queueResult([{ id: 'co1', teamId: 't1' }])
    queueResult([])

    await expectStatus(requireCompanyAccess('co1', 'outsider'), 403)
  })
})

describe('requireTeamMembership', () => {
  it('returns the membership row when the user is a member', async () => {
    queueResult([{ id: 'm1', role: 'admin' }])

    await expect(requireTeamMembership('t1', 'u1')).resolves.toMatchObject({ role: 'admin' })
  })

  it('throws 403 when the user is not a member', async () => {
    queueResult([])

    await expectStatus(requireTeamMembership('t1', 'u1'), 403)
  })
})

describe('requireInboxAccess', () => {
  it('returns the inbox when the user is a supportInboxMember', async () => {
    queueResult([{ id: 'i1', teamId: 't1' }])
    queueResult([{ id: 'sim1', role: 'agent' }])
    queueResult([])

    await expect(requireInboxAccess('i1', 'u1')).resolves.toMatchObject({ id: 'i1' })
  })

  it('returns the inbox when the user is not a member but is a team admin', async () => {
    // The bypass this stage adds: a support lead must be able to reach an
    // inbox before anyone has explicitly added them as a supportInboxMember.
    queueResult([{ id: 'i1', teamId: 't1' }])
    queueResult([])
    queueResult([{ id: 'm1' }])

    await expect(requireInboxAccess('i1', 'admin1')).resolves.toMatchObject({ id: 'i1' })
  })

  it('throws 404 when the inbox does not exist', async () => {
    queueResult([])

    await expectStatus(requireInboxAccess('missing', 'u1'), 404)
  })

  it('throws 403 when the user is neither a member nor a team admin', async () => {
    queueResult([{ id: 'i1', teamId: 't1' }])
    queueResult([])
    queueResult([])

    await expect(requireInboxAccess('i1', 'outsider')).rejects.toMatchObject({
      statusCode: 403,
      data: {
        error: {
          message: 'You do not have access to this support inbox',
        },
      },
    })
  })

  it('does not disclose the inbox name in the forbidden response', async () => {
    queueResult([{ id: 'i1', teamId: 't1', name: 'Private VIP Inbox' }])
    queueResult([])
    queueResult([])

    const result = requireInboxAccess('i1', 'outsider')
    await expect(result).rejects.toMatchObject({
      statusCode: 403,
      data: {
        error: {
          message: 'You do not have access to this support inbox',
        },
      },
    })
    await expect(result).rejects.not.toMatchObject({
      data: { error: { message: expect.stringContaining('Private VIP Inbox') } },
    })
  })

  it('returns effective admin access for a team admin', async () => {
    queueResult([{ id: 'i1', teamId: 't1', name: 'Private VIP Inbox' }])
    queueResult([])
    queueResult([{ id: 'm1', role: 'admin' }])

    await expect(requireInboxAccess('i1', 'admin1')).resolves.toMatchObject({
      id: 'i1',
      effectiveRole: 'admin',
      isTeamAdmin: true,
    })
  })

  it('gives a team admin effective admin access even when assigned as an agent', async () => {
    queueResult([{ id: 'i1', teamId: 't1', name: 'Shared inbox' }])
    queueResult([{ id: 'sim1', role: 'agent' }])
    queueResult([{ id: 'm1', role: 'admin' }])

    await expect(requireInboxAccess('i1', 'admin1')).resolves.toMatchObject({
      effectiveRole: 'admin',
      isTeamAdmin: true,
    })
  })

  it.each([['owner'], [undefined]] as const)(
    'fails closed for an inbox member with an invalid or missing role',
    async (role) => {
      queueResult([{ id: 'i1', teamId: 't1', name: 'Private inbox' }])
      queueResult([{ id: 'sim1', role }])
      queueResult([])

      await expect(requireInboxAccess('i1', 'u1')).rejects.toMatchObject({
        statusCode: 403,
        data: { error: { message: 'You do not have access to this support inbox' } },
      })
    }
  )

  it('checks team-admin precedence even when already a supportInboxMember', async () => {
    queueResult([{ id: 'i1', teamId: 't1' }])
    queueResult([{ id: 'sim1', role: 'agent' }])
    queueResult([])

    await requireInboxAccess('i1', 'u1')
    expect(queued.length).toBe(0)
  })
})

describe('support capabilities', () => {
  it('returns the literal capability matrix for ranked inbox roles', () => {
    expect(capabilitiesForRole('agent', false)).toEqual({
      canWorkConversations: true,
      canManageTagVocabulary: false,
      canManageMembers: false,
      canManageInbox: false,
      canManageTeamSupport: false,
    })
    expect(capabilitiesForRole('supervisor', false).canManageTagVocabulary).toBe(true)
    expect(capabilitiesForRole('admin', false).canManageInbox).toBe(true)
    expect(capabilitiesForRole('admin', true).canManageTeamSupport).toBe(true)
  })

  it('grants no support capability to a team member who belongs to no inbox', () => {
    // `resolveSupportTeamRole` returns null for this caller. Defaulting them to
    // `agent` made the UI advertise conversation controls that every server
    // check then refused.
    expect(capabilitiesForRole(null, false)).toEqual({
      canWorkConversations: false,
      canManageTagVocabulary: false,
      canManageMembers: false,
      canManageInbox: false,
      canManageTeamSupport: false,
    })
  })

  it('still reports team-support administration for a team admin with no inbox role', () => {
    expect(capabilitiesForRole(null, true).canManageTeamSupport).toBe(true)
    expect(capabilitiesForRole(null, true).canWorkConversations).toBe(false)
  })

  it('enforces the minimum ranked inbox role', async () => {
    queueResult([{ id: 'i1', teamId: 't1' }])
    queueResult([{ id: 'sim1', role: 'agent' }])

    await expect(requireInboxRole('i1', 'u1', 'supervisor')).rejects.toMatchObject({
      statusCode: 403,
      data: { error: { message: 'You do not have access to this support inbox' } },
    })
  })

  it('requires a team administrator for team-level support administration', async () => {
    queueResult([{ id: 'm1', role: 'member' }])

    await expect(requireTeamAdmin('t1', 'u1')).rejects.toMatchObject({
      statusCode: 403,
      data: { error: { message: 'You do not have access to this support inbox' } },
    })
  })

  it('resolves the highest support role available in a team', async () => {
    queueResult([{ id: 'm1', role: 'member' }])
    queueResult([{ role: 'agent' }, { role: 'supervisor' }])

    await expect(requireSupportTeamRole('t1', 'u1', 'supervisor')).resolves.toEqual({
      effectiveRole: 'supervisor',
      isTeamAdmin: false,
    })
  })

  it.each([['owner'], [undefined]] as const)(
    'fails closed when a support-team membership has an invalid or missing role',
    async (role) => {
      queueResult([{ id: 'm1', role: 'member' }])
      queueResult([{ role }])

      await expect(requireSupportTeamRole('t1', 'u1', 'agent')).rejects.toMatchObject({
        statusCode: 403,
        data: { error: { message: 'You do not have access to this support inbox' } },
      })
    }
  )
})

describe('requireConversationAccess', () => {
  it('returns the conversation when the user has inbox access', async () => {
    queueResult([{ id: 'c1', inboxId: 'i1' }])
    queueResult([{ id: 'i1', teamId: 't1' }])
    queueResult([{ id: 'sim1', role: 'agent' }])
    queueResult([])

    await expect(requireConversationAccess('c1', 'u1')).resolves.toMatchObject({ id: 'c1' })
  })

  it('throws 404 when the conversation does not exist', async () => {
    queueResult([])

    await expectStatus(requireConversationAccess('missing', 'u1'), 404)
  })

  it('throws 403 when the user has no access to the parent inbox', async () => {
    queueResult([{ id: 'c1', inboxId: 'i1' }])
    queueResult([{ id: 'i1', teamId: 't1' }])
    queueResult([])
    queueResult([])

    await expectStatus(requireConversationAccess('c1', 'outsider'), 403)
  })
})

describe('resolveInboxByAddress', () => {
  it('returns the inbox and matched address on an exact match', async () => {
    queueResult([{ id: 'addr1', inboxId: 'i1', address: 'support@acme.com', projectId: null }])
    queueResult([{ id: 'i1', teamId: 't1' }])

    await expect(resolveInboxByAddress('support@acme.com')).resolves.toMatchObject({
      inbox: { id: 'i1' },
      address: { id: 'addr1' },
    })
  })

  it('matches case-insensitively', async () => {
    queueResult([{ id: 'addr1', inboxId: 'i1', address: 'support@acme.com', projectId: null }])
    queueResult([{ id: 'i1', teamId: 't1' }])

    await expect(resolveInboxByAddress('Support@Acme.com')).resolves.toMatchObject({ inbox: { id: 'i1' } })
  })

  it('returns null when no address matches, rather than throwing', async () => {
    // Stage 03 records the event as an error and returns 200 on a miss,
    // rather than 404ing a mail provider that would otherwise retry forever.
    queueResult([])

    await expect(resolveInboxByAddress('nobody@acme.com')).resolves.toBeNull()
  })

  it('returns null when the address exists but its inbox is gone', async () => {
    queueResult([{ id: 'addr1', inboxId: 'i1', address: 'support@acme.com', projectId: null }])
    queueResult([])

    await expect(resolveInboxByAddress('support@acme.com')).resolves.toBeNull()
  })
})
