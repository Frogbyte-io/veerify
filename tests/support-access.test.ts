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

/**
 * Project access (org owner/admin, project_member, accessMode) lives in
 * `project-access.ts` and is covered by its own tests; here it is a controllable
 * stub so these tests only exercise what support-access adds on top.
 */
const projectAccess = vi.hoisted(() => ({
  role: null as 'admin' | 'member' | null,
}))

vi.mock('~/server/utils/project-access', async () => {
  const { createError } = await import('h3')
  const forbidden = () =>
    createError({ statusCode: 403, statusMessage: 'Forbidden', data: { error: { message: 'no project access' } } })
  return {
    resolveProjectRole: vi.fn(async () => projectAccess.role),
    requireProjectRole: vi.fn(async () => {
      if (!projectAccess.role) throw forbidden()
      return { project: { id: 'p' }, role: projectAccess.role }
    }),
    requireProjectAccess: vi.fn(async () => {
      if (!projectAccess.role) throw forbidden()
      return { id: 'p' }
    }),
  }
})

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
  requireInboxAccess,
  requireInboxRole,
  requireSupportProjectRole,
  capabilitiesForRole,
  requireConversationAccess,
  resolveInboxByAddress,
} = await import('~/server/utils/support-access')

async function expectStatus(promise: Promise<unknown>, statusCode: number) {
  await expect(promise).rejects.toMatchObject({ statusCode })
}

beforeEach(() => {
  queued.length = 0
  projectAccess.role = 'member'
})

describe('requireContactAccess', () => {
  it('returns the contact when the user is a member of its project', async () => {
    queueResult([{ id: 'c1', projectId: 't1', email: 'a@example.com' }])

    await expect(requireContactAccess('c1', 'u1')).resolves.toMatchObject({ id: 'c1', projectId: 't1' })
  })

  it('throws 404 when the contact does not exist', async () => {
    queueResult([])

    await expectStatus(requireContactAccess('missing', 'u1'), 404)
  })

  it('throws 403 when the contact exists but the user is not in its project', async () => {
    // The distinction matters: 404 means "no such contact", 403 means "exists,
    // not yours". Collapsing them would hide cross-tenant access attempts.
    queueResult([{ id: 'c1', projectId: 't1' }])
    projectAccess.role = null

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
  it('returns the company when the user is a member of its project', async () => {
    queueResult([{ id: 'co1', projectId: 't1', name: 'Acme' }])

    await expect(requireCompanyAccess('co1', 'u1')).resolves.toMatchObject({ id: 'co1', projectId: 't1' })
  })

  it('throws 404 when the company does not exist', async () => {
    queueResult([])

    await expectStatus(requireCompanyAccess('missing', 'u1'), 404)
  })

  it('throws 403 when the company exists but the user is not in its project', async () => {
    queueResult([{ id: 'co1', projectId: 't1' }])
    projectAccess.role = null

    await expectStatus(requireCompanyAccess('co1', 'outsider'), 403)
  })
})

describe('requireInboxAccess', () => {
  it('returns the inbox when the user is a supportInboxMember', async () => {
    queueResult([{ id: 'i1', projectId: 't1' }])
    queueResult([{ id: 'sim1', role: 'agent' }])
    queueResult([{ id: 'p1' }])

    await expect(requireInboxAccess('i1', 'u1')).resolves.toMatchObject({ id: 'i1' })
  })

  it('returns the inbox when the user is not a member but is a project admin', async () => {
    // The bypass this stage adds: a support lead must be able to reach an
    // inbox before anyone has explicitly added them as a supportInboxMember.
    queueResult([{ id: 'i1', projectId: 't1' }])
    queueResult([])
    queueResult([{ id: 'p1' }])
    projectAccess.role = 'admin'

    await expect(requireInboxAccess('i1', 'admin1')).resolves.toMatchObject({ id: 'i1' })
  })

  it('throws 404 when the inbox does not exist', async () => {
    queueResult([])

    await expectStatus(requireInboxAccess('missing', 'u1'), 404)
  })

  it('throws 403 when the user is neither a member nor a project admin', async () => {
    queueResult([{ id: 'i1', projectId: 't1' }])
    queueResult([])
    queueResult([{ id: 'p1' }])

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
    queueResult([{ id: 'i1', projectId: 't1', name: 'Private VIP Inbox' }])
    queueResult([])
    queueResult([{ id: 'p1' }])

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

  it('returns effective admin access for a project admin', async () => {
    queueResult([{ id: 'i1', projectId: 't1', name: 'Private VIP Inbox' }])
    queueResult([])
    queueResult([{ id: 'p1' }])
    projectAccess.role = 'admin'

    await expect(requireInboxAccess('i1', 'admin1')).resolves.toMatchObject({
      id: 'i1',
      effectiveRole: 'admin',
      isProjectAdmin: true,
    })
  })

  it('gives a project admin effective admin access even when assigned as an agent', async () => {
    queueResult([{ id: 'i1', projectId: 't1', name: 'Shared inbox' }])
    queueResult([{ id: 'sim1', role: 'agent' }])
    queueResult([{ id: 'p1' }])
    projectAccess.role = 'admin'

    await expect(requireInboxAccess('i1', 'admin1')).resolves.toMatchObject({
      effectiveRole: 'admin',
      isProjectAdmin: true,
    })
  })

  it.each([['owner'], [undefined]] as const)(
    'fails closed for an inbox member with an invalid or missing role',
    async (role) => {
      queueResult([{ id: 'i1', projectId: 't1', name: 'Private inbox' }])
      queueResult([{ id: 'sim1', role }])
      queueResult([{ id: 'p1' }])

      await expect(requireInboxAccess('i1', 'u1')).rejects.toMatchObject({
        statusCode: 403,
        data: { error: { message: 'You do not have access to this support inbox' } },
      })
    }
  )

  it('checks project-admin precedence even when already a supportInboxMember', async () => {
    queueResult([{ id: 'i1', projectId: 't1' }])
    queueResult([{ id: 'sim1', role: 'agent' }])
    queueResult([{ id: 'p1' }])

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
      canManageProjectSupport: false,
    })
    expect(capabilitiesForRole('supervisor', false).canManageTagVocabulary).toBe(true)
    expect(capabilitiesForRole('admin', false).canManageInbox).toBe(true)
    expect(capabilitiesForRole('admin', true).canManageProjectSupport).toBe(true)
  })

  it('grants no support capability to a project member who belongs to no inbox', () => {
    // `resolveSupportProjectRole` returns null for this caller. Defaulting them to
    // `agent` made the UI advertise conversation controls that every server
    // check then refused.
    expect(capabilitiesForRole(null, false)).toEqual({
      canWorkConversations: false,
      canManageTagVocabulary: false,
      canManageMembers: false,
      canManageInbox: false,
      canManageProjectSupport: false,
    })
  })

  it('still reports project-support administration for a project admin with no inbox role', () => {
    expect(capabilitiesForRole(null, true).canManageProjectSupport).toBe(true)
    expect(capabilitiesForRole(null, true).canWorkConversations).toBe(false)
  })

  it('enforces the minimum ranked inbox role', async () => {
    queueResult([{ id: 'i1', projectId: 't1' }])
    queueResult([{ id: 'sim1', role: 'agent' }])

    await expect(requireInboxRole('i1', 'u1', 'supervisor')).rejects.toMatchObject({
      statusCode: 403,
      data: { error: { message: 'You do not have access to this support inbox' } },
    })
  })

  it('resolves the highest support role available in a project', async () => {
    queueResult([{ role: 'agent' }, { role: 'supervisor' }])

    await expect(requireSupportProjectRole('t1', 'u1', 'supervisor')).resolves.toEqual({
      effectiveRole: 'supervisor',
      isProjectAdmin: false,
    })
  })

  it.each([['owner'], [undefined]] as const)(
    'fails closed when a support-project membership has an invalid or missing role',
    async (role) => {
      queueResult([{ role }])

      await expect(requireSupportProjectRole('t1', 'u1', 'agent')).rejects.toMatchObject({
        statusCode: 403,
        data: { error: { message: 'You do not have access to this support inbox' } },
      })
    }
  )
})

describe('requireConversationAccess', () => {
  it('returns the conversation when the user has inbox access', async () => {
    queueResult([{ id: 'c1', inboxId: 'i1' }])
    queueResult([{ id: 'i1', projectId: 't1' }])
    queueResult([{ id: 'sim1', role: 'agent' }])
    queueResult([{ id: 'p1' }])

    await expect(requireConversationAccess('c1', 'u1')).resolves.toMatchObject({ id: 'c1' })
  })

  it('throws 404 when the conversation does not exist', async () => {
    queueResult([])

    await expectStatus(requireConversationAccess('missing', 'u1'), 404)
  })

  it('throws 403 when the user has no access to the parent inbox', async () => {
    queueResult([{ id: 'c1', inboxId: 'i1' }])
    queueResult([{ id: 'i1', projectId: 't1' }])
    queueResult([])
    queueResult([{ id: 'p1' }])

    await expectStatus(requireConversationAccess('c1', 'outsider'), 403)
  })
})

describe('resolveInboxByAddress', () => {
  it('returns the inbox and matched address on an exact match', async () => {
    queueResult([{ id: 'addr1', inboxId: 'i1', address: 'support@acme.com', projectId: null }])
    queueResult([{ id: 'i1', projectId: 't1' }])

    await expect(resolveInboxByAddress('support@acme.com')).resolves.toMatchObject({
      inbox: { id: 'i1' },
      address: { id: 'addr1' },
    })
  })

  it('matches case-insensitively', async () => {
    queueResult([{ id: 'addr1', inboxId: 'i1', address: 'support@acme.com', projectId: null }])
    queueResult([{ id: 'i1', projectId: 't1' }])

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
