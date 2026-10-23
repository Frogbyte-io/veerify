import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { redactClientMetadata } from '../server/utils/feedback-source'

const state = vi.hoisted(() => ({
  results: [] as unknown[],
  teamMember: false,
  anonymous: false,
  feedbackRow: {} as Record<string, unknown>,
}))

// Every query resolves to the next queued result, whatever chain methods were used.
vi.mock('~/server/database/drizzle', () => {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'from', 'leftJoin', 'where', 'orderBy', 'limit', 'offset']) chain[m] = () => chain
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(state.results.shift()).then(resolve, reject)
  return { db: chain }
})
vi.mock('~/server/utils/auth-middleware', () => ({
  optionalAuth: vi.fn(async () => (state.anonymous ? null : { user: { id: 'u1', email: 'u@x.io' } })),
}))
vi.mock('~/server/utils/anonymous-session', () => ({ getAnonSession: vi.fn(async () => null) }))
vi.mock('~/server/utils/project-access', () => ({
  requireProjectAccess: vi.fn(async () => {
    if (!state.teamMember) throw new Error('forbidden')
  }),
  requirePublicProject: vi.fn(async () => undefined),
  resolvePublicProjectByTeam: vi.fn(async () => ({ project: { id: 'p1' } })),
}))
vi.mock('~/server/utils/validation', () => ({
  validateQuery: vi.fn(() => ({
    page: 1,
    limit: 20,
    sortBy: 'voteCount',
    sortOrder: 'desc',
    projectIds: [],
    projectId: 'p1',
  })),
}))

type Handler = (event: unknown) => Promise<{ data: any }>

const client = { appVersion: '1.2.3', os: 'macOS', osVersion: '15' }

describe('redactClientMetadata', () => {
  it('strips client for non-team viewers and keeps other keys', () => {
    expect(redactClientMetadata({ feedbackType: 'bug_report', client }, false)).toEqual({ feedbackType: 'bug_report' })
  })
  it('keeps client for team members', () => {
    expect(redactClientMetadata({ feedbackType: 'bug_report', client }, true)).toEqual({
      feedbackType: 'bug_report',
      client,
    })
  })
  it('passes through null metadata', () => {
    expect(redactClientMetadata(null, false)).toBeNull()
  })
})

describe('feedback source visibility in endpoints', () => {
  beforeEach(() => {
    vi.stubGlobal('defineEventHandler', (h: unknown) => h)
    vi.stubGlobal('createError', (i: Record<string, unknown>) => Object.assign(new Error('err'), i))
    vi.stubGlobal('getRouterParam', (_e: unknown, name: string) => (name === 'id' ? 'fb-1' : 'x'))
    state.results = []
    state.anonymous = false
    state.feedbackRow = {
      id: 'fb-1',
      projectId: 'p1',
      title: 'T',
      body: 'B',
      status: 'open',
      voteCount: 0,
      commentCount: 0,
      isPinned: false,
      authorUserId: null,
      authorSessionId: null,
      sourceLabel: 'Dot X',
      metadata: { feedbackType: 'bug_report', client },
    }
  })
  afterEach(() => vi.unstubAllGlobals())

  async function detail(teamMember: boolean) {
    state.teamMember = teamMember
    // feedback row, project row, vote lookup, subscription lookup (+ conversation count for team)
    state.results = teamMember
      ? [[{ feedback: state.feedbackRow, category: null }], [{ count: 0 }], [{ id: 'p1' }], [], []]
      : [[{ feedback: state.feedbackRow, category: null }], [{ id: 'p1' }], [], []]
    const handler = (await import('../server/api/feedback/[id]/index.get')).default as unknown as Handler
    return (await handler({})).data
  }

  it('strips metadata.client for non-team viewers', async () => {
    const data = await detail(false)
    expect(data.metadata.client).toBeUndefined()
    expect(data.metadata.feedbackType).toBe('bug_report')
    expect(data.sourceLabel).toBe('Dot X')
  })

  it('keeps metadata.client for team members', async () => {
    const data = await detail(true)
    expect(data.metadata.client).toEqual(client)
    expect(data.sourceLabel).toBe('Dot X')
  })

  it('public list maps sourceLabel and still omits metadata', async () => {
    const support = {
      ...state.feedbackRow,
      id: 'fb-2',
      sourceLabel: 'leak',
      metadata: { source: 'support_conversation' },
    }
    state.results = [
      [{ count: 2 }],
      [
        { feedback: state.feedbackRow, category: null },
        { feedback: support, category: null },
      ],
      [],
    ]
    const handler = (await import('../server/api/public/t/[teamSlug]/[projectSlug]/feedback.get'))
      .default as unknown as Handler
    const { items } = (await handler({})).data
    expect(items[0].sourceLabel).toBe('Dot X')
    expect(items[0].metadata).toBeUndefined()
    expect(items[1].sourceLabel).toBeNull()
  })

  describe('dashboard list endpoint', () => {
    async function list(opts: { anonymous?: boolean; memberTeamIds?: string[] }) {
      state.anonymous = Boolean(opts.anonymous)
      const row = {
        feedback: state.feedbackRow,
        category: null,
        projectTeamId: 't1',
        project: { id: 'p1' },
        githubIssue: null,
      }
      state.results = opts.anonymous
        ? [[{ count: 1 }], [row], []]
        : [[{ count: 1 }], [row], (opts.memberTeamIds ?? []).map((teamId) => ({ teamId })), []]
      const handler = (await import('../server/api/feedback/index.get')).default as unknown as Handler
      return (await handler({})).data.items[0]
    }

    it('redacts metadata.client for anonymous callers', async () => {
      const item = await list({ anonymous: true })
      expect(item.metadata.client).toBeUndefined()
      expect(item.metadata.feedbackType).toBe('bug_report')
      expect(item.sourceLabel).toBe('Dot X')
      expect(item.projectTeamId).toBeUndefined()
    })

    it("keeps metadata.client for a member of the item's project team", async () => {
      const item = await list({ memberTeamIds: ['t1'] })
      expect(item.metadata.client).toEqual(client)
    })

    it('redacts metadata.client for a logged-in non-member', async () => {
      const item = await list({ memberTeamIds: ['other-team'] })
      expect(item.metadata.client).toBeUndefined()
    })
  })
})
