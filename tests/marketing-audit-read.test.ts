import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  queue: [] as unknown[][],
  calls: [] as Array<{ query: number; op: string; args: unknown[] }>,
  queries: 0,
}))

vi.stubGlobal('defineEventHandler', (h: unknown) => h)
vi.stubGlobal('getRouterParam', (_e: unknown, name: string) => (name === 'projectId' ? 'p1' : 'a1'))

vi.mock('~/server/utils/auth-middleware', () => ({ requireAuth: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('~/server/utils/marketing-audit-access', () => ({
  requireAuditAccess: vi.fn(async () => ({
    audit: { id: 'a1', siteId: 'site-1', status: 'done', createdAt: new Date(), siteFacts: {}, score: 70 },
  })),
}))
vi.mock('~/server/utils/response', () => ({ createSuccessResponse: (data: unknown) => ({ success: true, data }) }))
vi.mock('~/server/utils/validation', () => ({ validateQuery: () => state.query }))
vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: vi.fn(() => {
      const id = state.queries++
      const chain: Record<string, unknown> = {}
      for (const name of ['from', 'where', 'orderBy', 'limit', 'groupBy']) {
        chain[name] = (...args: unknown[]) => {
          state.calls.push({ query: id, op: name, args })
          return chain
        }
      }
      // The ranked subquery (`.as('ranked')`) is only referenced, never awaited
      chain.as = () => new Proxy({}, { get: () => ({}) })
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(state.queue.shift() ?? []).then(resolve, reject)
      return chain
    }),
  },
}))

type Handler = (e: unknown) => Promise<{ data: Record<string, any> }>
const pagesGet = (await import('~/server/api/marketing/projects/[projectId]/audits/[auditId]/pages.get'))
  .default as unknown as Handler
const auditGet = (await import('~/server/api/marketing/projects/[projectId]/audits/[auditId]/index.get'))
  .default as unknown as Handler

const sqlOf = (c: unknown) => new PgDialect().sqlToQuery(c as never)

beforeEach(() => {
  state.query = {}
  state.queue = []
  state.calls = []
  state.queries = 0
})

describe('audit pages list', () => {
  it('fetches issue counts with one grouped query for the returned page ids', async () => {
    const pages = Array.from({ length: 3 }, (_, i) => ({ id: `pg${i}`, url: `https://x.com/${i}` }))
    state.queue = [pages, [{ pageId: 'pg1', count: 4 }]]
    const res = await pagesGet({})
    expect(res.data.pages).toEqual([
      { id: 'pg0', url: 'https://x.com/0', issueCount: 0 },
      { id: 'pg1', url: 'https://x.com/1', issueCount: 4 },
      { id: 'pg2', url: 'https://x.com/2', issueCount: 0 },
    ])
    expect(res.data.nextCursor).toBeNull()
    // pages query + exactly one count query, grouped by page and limited to the returned ids
    expect(state.queries).toBe(2)
    const countWhere = sqlOf(state.calls.find((c) => c.query === 1 && c.op === 'where')!.args[0])
    expect(countWhere.sql).toContain('"seo_issue"."page_id" in')
    expect(countWhere.params).toEqual(['pg0', 'pg1', 'pg2'])
    expect(state.calls.some((c) => c.query === 1 && c.op === 'groupBy')).toBe(true)
  })

  it('skips the count query for an empty page and counts only the first 50 rows of a longer list', async () => {
    state.queue = [[]]
    await pagesGet({})
    expect(state.queries).toBe(1)

    state.queries = 0
    state.calls = []
    state.queue = [Array.from({ length: 51 }, (_, i) => ({ id: `pg${i}`, url: `u${String(i).padStart(2, '0')}` })), []]
    const res = await pagesGet({})
    expect(res.data.nextCursor).toBe('u49')
    const countWhere = sqlOf(state.calls.find((c) => c.query === 1 && c.op === 'where')!.args[0])
    expect(countWhere.params).toHaveLength(50)
  })
})

describe('audit detail', () => {
  it('builds the summary from SQL totals and attaches the capped affected rows', async () => {
    state.queue = [
      // per (rule, severity) totals
      [
        { ruleId: 'missing-title', severity: 'error', total: 120 },
        { ruleId: 'missing-og', severity: 'notice', total: 3 },
      ],
      // capped rows (at most 50 per rule, enforced in SQL)
      [
        { ruleId: 'missing-title', pageUrl: 'https://x.com/a', details: {} },
        { ruleId: 'missing-og', pageUrl: 'https://x.com/b', details: {} },
      ],
      [], // previous audit
    ]
    const res = await auditGet({})
    expect(res.data.summary).toEqual({
      bySeverity: { error: 120, warning: 0, notice: 3 },
      byRule: { 'missing-title': 120, 'missing-og': 3 },
      total: 123,
    })
    const title = res.data.issues.find((i: { ruleId: string }) => i.ruleId === 'missing-title')
    expect(title.total).toBe(120)
    expect(title.affected).toHaveLength(1)
    expect(res.data.previousScore).toBeNull()

    // totals are a GROUP BY; the capped query is a row_number() window filtered to <= 50 per rule
    expect(state.calls.some((c) => c.query === 0 && c.op === 'groupBy')).toBe(true)
    expect(state.calls.some((c) => c.query === 2 && c.op === 'where')).toBe(true)
    expect(state.queries).toBe(4) // totals, ranked subquery, capped rows, previous score
  })
})
