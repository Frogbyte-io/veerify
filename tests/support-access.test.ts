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
      where: () => thenable,
      limit: () => Promise.resolve(result),
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
    queueResult([{ id: 'sim1' }])

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

    await expectStatus(requireInboxAccess('i1', 'outsider'), 403)
  })

  it('does not check team admin when already a supportInboxMember', async () => {
    queueResult([{ id: 'i1', teamId: 't1' }])
    queueResult([{ id: 'sim1' }])

    await requireInboxAccess('i1', 'u1')
    expect(queued.length).toBe(0)
  })
})

describe('requireConversationAccess', () => {
  it('returns the conversation when the user has inbox access', async () => {
    queueResult([{ id: 'c1', inboxId: 'i1' }])
    queueResult([{ id: 'i1', teamId: 't1' }])
    queueResult([{ id: 'sim1' }])

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
