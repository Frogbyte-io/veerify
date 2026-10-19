import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventHandler } from 'h3'

const authState = vi.hoisted(() => ({ userId: 'agent-1' }))
const queryTrace = vi.hoisted(() => ({ joinedQueries: 0, whereQueries: 0, projectedQueries: 0 }))
const queued: unknown[][] = []

function queueResult(rows: unknown[]) {
  queued.push(rows)
}

function nextResult() {
  return queued.shift() ?? []
}

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getQuery', () => ({ teamId: 'team-1' }))
vi.stubGlobal('getRouterParam', (_event: unknown, name: string) => (name === 'teamId' ? 'team-1' : 'inbox-2'))

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: authState.userId } })),
}))

vi.mock('~/server/database/drizzle', () => {
  const makeChain = () => {
    let isJoined = false
    const chain: Record<string, unknown> = {
      from: () => chain,
      innerJoin: () => {
        isJoined = true
        queryTrace.joinedQueries += 1
        return chain
      },
      leftJoin: () => chain,
      where: () => {
        queryTrace.whereQueries += 1
        return chain
      },
      orderBy: () => {
        const rows = nextResult()
        if (!isJoined) return Promise.resolve(rows)
        return Promise.resolve(
          rows.filter((row) => {
            const candidate = row as {
              inbox?: { teamId?: string }
              supportInbox?: { teamId?: string }
              supportInboxMember?: { userId?: string }
            }
            const inbox = candidate.inbox ?? candidate.supportInbox ?? (candidate as { teamId?: string })
            if (candidate.inbox) return inbox.teamId === 'team-1'
            const member = candidate.supportInboxMember ?? (candidate as { userId?: string })
            return inbox.teamId === 'team-1' && member.userId === authState.userId
          })
        )
      },
      limit: () => Promise.resolve(nextResult()),
      then: (...callbacks: unknown[]) =>
        // eslint-disable-next-line no-unused-vars
        Promise.resolve(nextResult()).then(callbacks[0] as (...args: [unknown[]]) => unknown),
    }
    return chain
  }

  return {
    db: {
      select: (fields?: Record<string, unknown>) => {
        if (fields && 'inbox' in fields && 'role' in fields) {
          queryTrace.projectedQueries += 1
        }
        return makeChain()
      },
    },
  }
})

const listHandler = (await import('~/server/api/support/inboxes/index.get')).default as EventHandler
const detailHandler = (await import('~/server/api/support/inboxes/[id].get')).default as EventHandler
const settingsHandler = (await import('~/server/api/support/teams/[teamId]/settings.get')).default as EventHandler

function asEvent(value: unknown): Parameters<EventHandler>[0] {
  return value as Parameters<EventHandler>[0]
}

beforeEach(() => {
  queued.length = 0
  queryTrace.joinedQueries = 0
  queryTrace.whereQueries = 0
  queryTrace.projectedQueries = 0
  vi.stubGlobal('createError', (input: Record<string, unknown>) =>
    Object.assign(new Error(String(input.statusMessage)), input)
  )
})

describe('support inbox list authorization', () => {
  it('returns only assigned inboxes with agent capabilities', async () => {
    authState.userId = 'agent-1'
    queueResult([{ id: 'team-member-1', role: 'member' }])
    queueResult([
      {
        inbox: { id: 'inbox-1', teamId: 'team-1', name: 'Assigned inbox' },
        role: 'agent',
      },
      {
        inbox: { id: 'inbox-invalid', teamId: 'team-1', name: 'Invalid inbox' },
        role: 'owner',
      },
      {
        inbox: { id: 'inbox-missing-role', teamId: 'team-1', name: 'Missing role inbox' },
      },
    ])

    const result = await listHandler(asEvent({}))

    expect(result).toMatchObject({
      success: true,
      data: {
        inboxes: [
          {
            id: 'inbox-1',
            name: 'Assigned inbox',
            effectiveRole: 'agent',
            isTeamAdmin: false,
            capabilities: {
              canWorkConversations: true,
              canManageTagVocabulary: false,
              canManageMembers: false,
              canManageInbox: false,
              canManageTeamSupport: false,
            },
          },
        ],
      },
    })
    expect(result.data.inboxes).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'inbox-2' })]))
    expect(result.data.inboxes).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'inbox-hidden' })]))
    expect(result.data.inboxes).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'inbox-invalid' })]))
    expect(result.data.inboxes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'inbox-missing-role' })])
    )
    expect(queryTrace.joinedQueries).toBe(1)
    expect(queryTrace.whereQueries).toBe(2)
    expect(queryTrace.projectedQueries).toBe(1)
  })

  it('returns every team inbox with effective admin capabilities for team admins', async () => {
    authState.userId = 'admin-1'
    queueResult([{ id: 'team-admin-1', role: 'admin' }])
    queueResult([
      { id: 'inbox-1', teamId: 'team-1', name: 'First inbox' },
      { id: 'inbox-2', teamId: 'team-1', name: 'Second inbox' },
    ])

    const result = await listHandler(asEvent({}))

    expect(result.data.inboxes).toHaveLength(2)
    expect(result.data.inboxes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'inbox-2',
          effectiveRole: 'admin',
          isTeamAdmin: true,
          capabilities: expect.objectContaining({
            canManageInbox: true,
            canManageTeamSupport: true,
          }),
        }),
      ])
    )
  })

  it('returns an empty list for an unassigned team member', async () => {
    authState.userId = 'unassigned-1'
    queueResult([{ id: 'team-member-2', role: 'member' }])
    queueResult([])

    const result = await listHandler(asEvent({}))

    expect(result).toMatchObject({ success: true, data: { inboxes: [] } })
  })

  it('returns the highest assigned support role in team settings', async () => {
    authState.userId = 'supervisor-1'
    queueResult([{ id: 'team-member-3', role: 'member' }])
    queueResult([{ role: 'agent' }, { role: 'supervisor' }])
    queueResult([{ teamId: 'team-1', autoLinkFeedback: false }])

    const result = await settingsHandler(asEvent({}))

    expect(result).toMatchObject({
      success: true,
      data: {
        effectiveRole: 'supervisor',
        isTeamAdmin: false,
        capabilities: {
          canWorkConversations: true,
          canManageTagVocabulary: true,
        },
      },
    })
  })

  // Settings stay readable for a team member who belongs to no inbox - the page
  // still renders - but they carry no support capability. The approved matrix's
  // "Unassigned team member" column is `No` for every conversation capability,
  // and the previous `agent` fallback made the UI advertise controls that every
  // server-side check then refused.
  it('grants no support capability in settings for an unassigned member', async () => {
    authState.userId = 'unassigned-settings-1'
    queueResult([{ id: 'team-member-4', role: 'member' }])
    queueResult([])
    queueResult([])

    const result = await settingsHandler(asEvent({}))

    expect(result).toMatchObject({
      success: true,
      data: {
        effectiveRole: null,
        isTeamAdmin: false,
        capabilities: {
          canWorkConversations: false,
          canManageTagVocabulary: false,
          canManageMembers: false,
          canManageInbox: false,
          canManageTeamSupport: false,
        },
      },
    })
  })

  it('keeps team admins effective admin in settings', async () => {
    authState.userId = 'admin-settings-1'
    queueResult([{ id: 'team-admin-2', role: 'admin' }])
    queueResult([])

    const result = await settingsHandler(asEvent({}))

    expect(result).toMatchObject({
      success: true,
      data: {
        effectiveRole: 'admin',
        isTeamAdmin: true,
        capabilities: { canManageTeamSupport: true },
      },
    })
  })
})

describe('support inbox detail authorization', () => {
  it('does not disclose inaccessible inbox metadata to an unassigned member', async () => {
    authState.userId = 'unassigned-1'
    queueResult([{ id: 'inbox-2', teamId: 'team-1', name: 'Private inbox' }])
    queueResult([])
    queueResult([])

    await expect(detailHandler(asEvent({}))).rejects.toMatchObject({
      statusCode: 403,
      data: {
        error: {
          message: 'You do not have access to this support inbox',
        },
      },
    })
  })
})
