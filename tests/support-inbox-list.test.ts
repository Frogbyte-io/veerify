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
vi.stubGlobal('getQuery', () => ({ projectId: 'project-1' }))
vi.stubGlobal('getRouterParam', (_event: unknown, name: string) => (name === 'projectId' ? 'project-1' : 'inbox-2'))

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: authState.userId } })),
}))

// Project access is its own module (covered by its own tests). The first queued
// row stands in for the caller's membership: absent means no access.
vi.mock('~/server/utils/project-access', () => {
  const forbidden = () =>
    Object.assign(new Error('Forbidden'), { statusCode: 403, statusMessage: 'Forbidden', data: {} })
  const membership = () => {
    const row = queued.shift()?.[0] as { role: string } | undefined
    if (!row) throw forbidden()
    return row
  }
  return {
    requireProjectAccess: vi.fn(async () => membership()),
    requireProjectRole: vi.fn(async () => {
      const row = membership()
      return { project: row, role: row.role }
    }),
    requireProjectAdmin: vi.fn(async () => {
      const row = membership()
      if (row.role !== 'admin') throw forbidden()
      return row
    }),
  }
})

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
              inbox?: { projectId?: string }
              supportInbox?: { projectId?: string }
              supportInboxMember?: { userId?: string }
            }
            const inbox = candidate.inbox ?? candidate.supportInbox ?? (candidate as { projectId?: string })
            if (candidate.inbox) return inbox.projectId === 'project-1'
            const member = candidate.supportInboxMember ?? (candidate as { userId?: string })
            return inbox.projectId === 'project-1' && member.userId === authState.userId
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
const settingsHandler = (await import('~/server/api/support/projects/[projectId]/settings.get')).default as EventHandler

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
    queueResult([{ id: 'project-member-1', role: 'member' }])
    queueResult([
      {
        inbox: { id: 'inbox-1', projectId: 'project-1', name: 'Assigned inbox' },
        role: 'agent',
      },
      {
        inbox: { id: 'inbox-invalid', projectId: 'project-1', name: 'Invalid inbox' },
        role: 'owner',
      },
      {
        inbox: { id: 'inbox-missing-role', projectId: 'project-1', name: 'Missing role inbox' },
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
            isProjectAdmin: false,
            capabilities: {
              canWorkConversations: true,
              canManageTagVocabulary: false,
              canManageMembers: false,
              canManageInbox: false,
              canManageProjectSupport: false,
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
    expect(queryTrace.whereQueries).toBe(1)
    expect(queryTrace.projectedQueries).toBe(1)
  })

  it('returns every project inbox with effective admin capabilities for project admins', async () => {
    authState.userId = 'admin-1'
    queueResult([{ id: 'project-admin-1', role: 'admin' }])
    queueResult([
      { id: 'inbox-1', projectId: 'project-1', name: 'First inbox' },
      { id: 'inbox-2', projectId: 'project-1', name: 'Second inbox' },
    ])

    const result = await listHandler(asEvent({}))

    expect(result.data.inboxes).toHaveLength(2)
    expect(result.data.inboxes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'inbox-2',
          effectiveRole: 'admin',
          isProjectAdmin: true,
          capabilities: expect.objectContaining({
            canManageInbox: true,
            canManageProjectSupport: true,
          }),
        }),
      ])
    )
  })

  it('returns an empty list for an unassigned project member', async () => {
    authState.userId = 'unassigned-1'
    queueResult([{ id: 'project-member-2', role: 'member' }])
    queueResult([])

    const result = await listHandler(asEvent({}))

    expect(result).toMatchObject({ success: true, data: { inboxes: [] } })
  })

  it('returns the highest assigned support role in project settings', async () => {
    authState.userId = 'supervisor-1'
    queueResult([{ id: 'project-member-3', role: 'member' }])
    queueResult([{ role: 'agent' }, { role: 'supervisor' }])
    queueResult([{ projectId: 'project-1', autoLinkFeedback: false }])

    const result = await settingsHandler(asEvent({}))

    expect(result).toMatchObject({
      success: true,
      data: {
        effectiveRole: 'supervisor',
        isProjectAdmin: false,
        capabilities: {
          canWorkConversations: true,
          canManageTagVocabulary: true,
        },
      },
    })
  })

  // Settings stay readable for a project member who belongs to no inbox - the page
  // still renders - but they carry no support capability. The approved matrix's
  // "Unassigned project member" column is `No` for every conversation capability,
  // and the previous `agent` fallback made the UI advertise controls that every
  // server-side check then refused.
  it('grants no support capability in settings for an unassigned member', async () => {
    authState.userId = 'unassigned-settings-1'
    queueResult([{ id: 'project-member-4', role: 'member' }])
    queueResult([])
    queueResult([])

    const result = await settingsHandler(asEvent({}))

    expect(result).toMatchObject({
      success: true,
      data: {
        effectiveRole: null,
        isProjectAdmin: false,
        capabilities: {
          canWorkConversations: false,
          canManageTagVocabulary: false,
          canManageMembers: false,
          canManageInbox: false,
          canManageProjectSupport: false,
        },
      },
    })
  })

  it('keeps project admins effective admin in settings', async () => {
    authState.userId = 'admin-settings-1'
    queueResult([{ id: 'project-admin-2', role: 'admin' }])
    queueResult([])

    const result = await settingsHandler(asEvent({}))

    expect(result).toMatchObject({
      success: true,
      data: {
        effectiveRole: 'admin',
        isProjectAdmin: true,
        capabilities: { canManageProjectSupport: true },
      },
    })
  })
})

describe('support inbox detail authorization', () => {
  it('does not disclose inaccessible inbox metadata to an unassigned member', async () => {
    authState.userId = 'unassigned-1'
    queueResult([{ id: 'inbox-2', projectId: 'project-1', name: 'Private inbox' }])
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
