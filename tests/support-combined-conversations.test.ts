import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventHandler } from 'h3'
import { decodeListCursor } from '~/server/utils/list-cursor'

type Project = { id: string; name: string; slug: string; role: 'admin' | 'member'; settings: Record<string, unknown> }

const state = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  /** Rows each successive `db.select()` resolves to: chip counts, the list page, unread counts. */
  queuedRows: [] as unknown[][],
  selects: 0,
  joinedTables: [] as unknown[],
  projects: [] as Array<Record<string, unknown>>,
  scopeProjects: [] as Array<Record<string, unknown>>,
  inboxes: [] as Array<{ id: string; name: string; projectId: string }>,
  scopeError: null as Error | null,
  scopeOptions: [] as unknown[],
  inboxProjects: [] as unknown[],
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getQuery', () => state.query)
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
  Object.assign(new Error(String(input.statusMessage)), input)
)

vi.mock('~/server/utils/project-context', () => ({
  requireScopedProjects: vi.fn(async (_event: unknown, options: unknown) => {
    state.scopeOptions.push(options)
    if (state.scopeError) throw state.scopeError
    return { session: { user: { id: 'agent-1' } }, projects: state.projects, scopeProjects: state.scopeProjects }
  }),
}))

vi.mock('~/server/utils/support-access', () => ({
  listAccessibleInboxes: vi.fn(async (_userId: string, projects: unknown) => {
    state.inboxProjects.push(projects)
    return state.inboxes
  }),
}))

vi.mock('~/server/database/drizzle', () => {
  const chain = (rows: unknown[]) => {
    const result = Promise.resolve(rows)
    const fluent: Record<string, unknown> = {
      from: () => fluent,
      innerJoin: (table: unknown) => {
        state.joinedTables.push(table)
        return fluent
      },
      leftJoin: () => fluent,
      where: () => fluent,
      orderBy: () => fluent,
      groupBy: () => result,
      limit: () => result,
      then: (...args: Parameters<Promise<unknown>['then']>) => result.then(...args),
    }
    return fluent
  }
  return {
    db: {
      select: () => {
        state.selects += 1
        return chain(state.queuedRows.shift() ?? [])
      },
    },
  }
})

const handler = (await import('~/server/api/support/conversations/combined.get')).default as EventHandler
const supportSchema = await import('~/server/database/schema/support')

type Result = {
  data: {
    conversations: Array<Record<string, unknown>>
    hasMore: boolean
    nextCursor: string | null
    projectCounts: Record<string, number>
    totalInboxes: number
    inboxes: Array<{ id: string; name: string; projectId: string; emailAddress?: string | null }>
    unreadCounts: Record<string, number>
  }
}
const run = () => handler({} as Parameters<EventHandler>[0]) as Promise<Result>

const project = (id: string, over: Partial<Project> = {}): Project => ({
  id,
  name: `Project ${id}`,
  slug: `project-${id}`,
  role: 'admin',
  settings: { supportEnabled: true },
  ...over,
})

function row(id: string, projectId: string, inboxId: string, over: Record<string, unknown> = {}) {
  const createdAt = new Date('2026-11-01T10:00:00Z')
  return {
    id,
    projectId,
    inboxId,
    createdAt,
    assigneeUserId: null,
    lastCustomerReplyAt: null,
    lastAgentReplyAt: null,
    lastReadAt: null,
    mailAddress: 'hello@example.com',
    ...over,
  }
}

beforeEach(() => {
  state.query = {}
  state.queuedRows = []
  state.selects = 0
  state.joinedTables = []
  state.scopeError = null
  state.scopeOptions = []
  state.inboxProjects = []
  state.projects = [project('p1'), project('p2')]
  state.scopeProjects = [project('p1'), project('p2')]
  state.inboxes = [
    { id: 'i1', name: 'Support', projectId: 'p1' },
    { id: 'i2', name: 'Help', projectId: 'p2' },
  ]
})

describe('GET /api/support/conversations/combined', () => {
  it('asks for the scoped projects that have Inbox on', async () => {
    await run()
    expect(state.scopeOptions).toEqual([{ module: 'supportEnabled' }])
  })

  it('tags each conversation with its project and inbox and reports unread state', async () => {
    state.queuedRows = [
      [
        { projectId: 'p1', count: 1 },
        { projectId: 'p2', count: 1 },
      ],
      [
        row('c1', 'p2', 'i2', { lastReadAt: null }),
        row('c2', 'p1', 'i1', { lastReadAt: new Date('2026-11-01T11:00:00Z') }),
      ],
      [{ unassigned: 1, assignedToMe: 0, inbox: 1, breachingSoon: 0 }],
    ]
    const { data } = await run()

    expect(data.conversations.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(data.conversations[0]).toMatchObject({
      project: { id: 'p2', name: 'Project p2', slug: 'project-p2' },
      inbox: { id: 'i2', name: 'Help' },
      isUnread: true,
    })
    expect(data.conversations[1]).toMatchObject({ project: { id: 'p1' }, inbox: { id: 'i1' }, isUnread: false })
    expect(data.unreadCounts).toEqual({ unassigned: 1, assignedToMe: 0, inbox: 1, breachingSoon: 0 })
    expect(data.totalInboxes).toBe(2)
    expect(data.hasMore).toBe(false)
    expect(data.nextCursor).toBeNull()
  })

  it('counts every project with Inbox on for the chips, even ones the filter left out', async () => {
    // Only p1 is chosen, p2 is outside the filter and p3 has Inbox switched off.
    state.projects = [project('p1')]
    state.scopeProjects = [project('p1'), project('p2'), project('p3', { settings: { supportEnabled: false } })]
    state.queuedRows = [[{ projectId: 'p2', count: 4 }], [], [{}]]
    const { data } = await run()

    expect(data.projectCounts).toEqual({ p1: 0, p2: 4 })
    // The list and the inbox list cover p1 only; the chip counts and `totalInboxes` do not.
    expect(data.inboxes).toEqual([{ id: 'i1', name: 'Support', projectId: 'p1', emailAddress: null }])
    expect(data.totalInboxes).toBe(2)
    expect(
      (state.inboxProjects[0] as Array<{ id: string }>).map((p) => p.id),
      'accessible inboxes are looked up for the projects with Inbox on'
    ).toEqual(['p1', 'p2'])
  })

  it('returns an empty page without querying when the caller can work in no inbox', async () => {
    state.inboxes = []
    const { data } = await run()

    expect(state.selects).toBe(0)
    expect(data).toMatchObject({
      conversations: [],
      hasMore: false,
      totalInboxes: 0,
      inboxes: [],
      projectCounts: { p1: 0, p2: 0 },
      unreadCounts: { unassigned: 0, assignedToMe: 0, inbox: 0, breachingSoon: 0 },
    })
  })

  it('keeps the chip counts but lists nothing when the chosen projects have no inbox for the caller', async () => {
    state.projects = [project('p2')]
    state.inboxes = [{ id: 'i1', name: 'Support', projectId: 'p1' }]
    state.queuedRows = [[{ projectId: 'p1', count: 3 }]]
    const { data } = await run()

    expect(state.selects).toBe(1)
    expect(data.conversations).toEqual([])
    expect(data.projectCounts).toEqual({ p1: 3, p2: 0 })
    expect(data.totalInboxes).toBe(1)
    expect(data.inboxes).toEqual([])
  })

  it('pages with a (createdAt, id) cursor taken from the last listed conversation', async () => {
    state.query = { limit: '1' }
    state.queuedRows = [[], [row('c1', 'p1', 'i1'), row('c2', 'p2', 'i2')], [{}]]
    const { data } = await run()

    expect(data.hasMore).toBe(true)
    expect(data.conversations.map((c) => c.id)).toEqual(['c1'])
    expect(decodeListCursor(data.nextCursor!, 'conversation')).toEqual({
      createdAt: new Date('2026-11-01T10:00:00Z'),
      id: 'c1',
    })
  })

  it('rejects a malformed cursor with 400', async () => {
    state.query = { cursor: 'not-a-cursor' }
    state.queuedRows = [[]]
    await expect(run()).rejects.toMatchObject({ statusCode: 400 })
  })

  it('joins contacts only when searching', async () => {
    state.queuedRows = [[], [], [{}]]
    await run()
    expect(state.joinedTables).not.toContain(supportSchema.contact)

    state.joinedTables = []
    state.query = { search: 'refund' }
    state.queuedRows = [[], [], [{}]]
    await run()
    // Once for the chip counts and once for the list.
    expect(state.joinedTables.filter((table) => table === supportSchema.contact)).toHaveLength(2)
  })

  it('validates the query like the single-inbox list', async () => {
    state.query = { view: 'everything' }
    await expect(run()).rejects.toMatchObject({ statusCode: 400 })
    state.query = { limit: '500' }
    await expect(run()).rejects.toMatchObject({ statusCode: 400 })
  })

  it('passes through the 403 for a project outside the scope', async () => {
    state.scopeError = Object.assign(new Error('Forbidden'), { statusCode: 403 })
    await expect(run()).rejects.toMatchObject({ statusCode: 403 })
    expect(state.selects).toBe(0)
  })
})
