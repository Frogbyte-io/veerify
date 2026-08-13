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

const { requireContactAccess, requireTeamMembership } = await import('~/server/utils/support-access')

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
