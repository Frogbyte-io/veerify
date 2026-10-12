import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  results: [] as unknown[][],
  selects: 0,
  project: {} as Record<string, unknown>,
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRequestURL', () => ({ protocol: 'https:', port: '' }))
vi.stubGlobal('useRuntimeConfig', () => ({ public: { appDomain: 'veerify.test' } }))

vi.mock('~/server/utils/team-context', () => ({
  requireAuthWithResolvedTeam: vi.fn(async () => ({ session: { user: { id: 'u1' } } })),
}))
vi.mock('~/server/utils/marketing-site', () => ({
  requireRouteParam: (event: { projectId: string }) => event.projectId,
}))
vi.mock('~/server/utils/response', () => ({
  createSuccessResponse: (data: unknown) => ({ success: true, data }),
}))
vi.mock('~/server/utils/roadmap-access', () => ({
  requireRoadmapAccess: vi.fn(async (projectId: string) => {
    if (projectId === 'foreign') throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
    return { project: state.project, teamId: 't1' }
  }),
}))
vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: () => {
      const result = state.results[state.selects++] ?? []
      const chain: Record<string, unknown> = {}
      for (const key of ['from', 'leftJoin', 'where']) chain[key] = () => chain
      chain.orderBy = () => Promise.resolve(result)
      chain.limit = () => Promise.resolve(result)
      return chain
    },
  },
}))

const handler = (await import('~/server/api/roadmap/projects/[projectId]/index.get')).default as unknown as (
  event: unknown
) => Promise<{ data: any }>

const row = (over: Record<string, unknown>, category: unknown = null) => ({
  feedback: {
    id: 'f',
    title: 'T',
    status: 'open',
    voteCount: 0,
    commentCount: 0,
    isPinned: false,
    isHidden: false,
    metadata: null,
    createdAt: new Date(0),
    ...over,
  },
  category,
})

beforeEach(() => {
  state.selects = 0
  state.project = { id: 'p1', name: 'App', slug: 'app', isPublic: true, customDomain: null, settings: {} }
  state.results = [
    [], // no custom statuses -> system statuses
    [
      row({ id: 'a', title: 'Visible', voteCount: 3 }, { id: 'c1', name: 'UI', slug: 'ui', icon: null, color: null }),
      row({ id: 'b', title: 'Secret idea', isHidden: true }),
      row({ id: 'c', title: 'Customer cannot log in', metadata: { source: 'support_conversation' } }),
    ],
    [{ slug: 'acme' }],
  ]
})

describe('GET /api/roadmap/projects/[projectId]', () => {
  it('includes hidden items flagged isHidden and real titles of support-derived items', async () => {
    const { data } = await handler({ projectId: 'p1' })
    const open = data.columns.find((c: any) => c.value === 'open')
    const byId = Object.fromEntries(open.items.map((i: any) => [i.id, i]))
    expect(byId.b).toMatchObject({ title: 'Secret idea', isHidden: true })
    expect(byId.c).toMatchObject({ title: 'Customer cannot log in', fromSupport: true })
    expect(byId.a).toMatchObject({ voteCount: 3, commentCount: 0, isPinned: false, category: { name: 'UI' } })
  })

  it('returns the public roadmap URL for public products, null otherwise', async () => {
    const { data } = await handler({ projectId: 'p1' })
    expect(data.publicUrl).toBe('https://acme.veerify.test/app/roadmap')

    state.selects = 0
    state.project = { ...state.project, isPublic: false }
    const { data: priv } = await handler({ projectId: 'p1' })
    expect(priv.publicUrl).toBeNull()
  })

  it('rejects other teams products before reading any data', async () => {
    await expect(handler({ projectId: 'foreign' })).rejects.toMatchObject({ statusCode: 403 })
    expect(state.selects).toBe(0)
  })
})
