import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  params: { projectId: 'p1', mentionId: 'm1' } as Record<string, string>,
  body: {} as unknown,
  query: {} as Record<string, unknown>,
  site: { id: 'site-1', verifiedAt: new Date() } as { id: string; verifiedAt: Date | null } | null,
  updateRows: [] as unknown[],
  updateWhere: null as unknown,
  updateSet: null as unknown,
  access: 'ok' as 'ok' | 'forbidden',
  canEscalate: false,
  selectQueue: [] as unknown[][],
  calls: [] as Array<{ op: string; args: unknown[] }>,
  reachableInboxes: [] as string[],
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_event: unknown, name: string) => state.params[name])
vi.stubGlobal('getQuery', () => state.query)
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: 'u1' } })),
}))

vi.mock('~/server/utils/marketing-access', () => ({
  requireMarketingAccess: vi.fn(async () => {
    if (state.access === 'forbidden') {
      throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
    }
    return { project: {}, organizationId: 'o1' }
  }),
}))

vi.mock('~/server/utils/marketing-mentions', async (importOriginal) => {
  const original = await importOriginal<typeof import('~/server/utils/marketing-mentions')>()
  return {
    ...original,
    findMentionsSite: vi.fn(async () => state.site),
    requireMentionsSite: vi.fn(async () => {
      if (!state.site) throw Object.assign(new Error('Not Found'), { statusCode: 404 })
      return state.site
    }),
  }
})

vi.mock('~/server/services/marketing/mentions/escalation', () => ({
  canEscalateMentions: vi.fn(async () => state.canEscalate),
  accessibleInboxIds: vi.fn(
    async (ids: Iterable<string>) => new Set([...ids].filter((id) => state.reachableInboxes.includes(id)))
  ),
}))

vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      for (const name of ['from', 'leftJoin', 'where', 'orderBy', 'limit', 'groupBy']) {
        chain[name] = (...args: unknown[]) => {
          state.calls.push({ op: name, args })
          return chain
        }
      }
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(state.selectQueue.shift() ?? []).then(resolve, reject)
      return chain
    }),
    update: vi.fn(() => ({
      set: (values: unknown) => {
        state.updateSet = values
        return {
          where: (condition: unknown) => {
            state.updateWhere = condition
            return { returning: async () => state.updateRows }
          },
        }
      },
    })),
  },
}))

const patchHandler = (await import('~/server/api/marketing/projects/[projectId]/mentions/[mentionId].patch')).default
const bulkHandler = (await import('~/server/api/marketing/projects/[projectId]/mentions/bulk.post')).default
const listHandler = (await import('~/server/api/marketing/projects/[projectId]/mentions/index.get')).default

const sqlOf = (condition: unknown) => new PgDialect().sqlToQuery(condition as never)

beforeEach(() => {
  state.params = { projectId: 'p1', mentionId: 'm1' }
  state.body = { status: 'seen' }
  state.query = {}
  state.site = { id: 'site-1', verifiedAt: new Date() }
  state.updateRows = [{ id: 'm1', status: 'seen' }]
  state.updateWhere = null
  state.access = 'ok'
  state.calls = []
  state.canEscalate = false
  state.selectQueue = []
  state.reachableInboxes = []
})

describe('PATCH mention', () => {
  it('scopes the update to the product site so other sites mentions are untouchable', async () => {
    await patchHandler({} as never)
    const { sql, params } = sqlOf(state.updateWhere)
    expect(sql).toContain('"mention"."site_id"')
    expect(params).toEqual(expect.arrayContaining(['m1', 'site-1']))
  })

  it('returns 404 when the mention belongs to another site', async () => {
    state.updateRows = []
    await expect(patchHandler({} as never)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects statuses a user may not set', async () => {
    state.body = { status: 'escalated' }
    await expect(patchHandler({} as never)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('propagates marketing access failures before touching data', async () => {
    state.access = 'forbidden'
    await expect(patchHandler({} as never)).rejects.toMatchObject({ statusCode: 403 })
    expect(state.updateWhere).toBeNull()
  })
})

describe('POST bulk', () => {
  it('limits the update to the site and reports the updated count', async () => {
    state.body = { ids: ['a', 'b', 'a'], status: 'dismissed' }
    state.updateRows = [{ id: 'a' }, { id: 'b' }]
    const result = await bulkHandler({} as never)
    const { sql, params } = sqlOf(state.updateWhere)
    expect(sql).toContain('"mention"."site_id"')
    expect(params).toEqual(expect.arrayContaining(['site-1', 'a', 'b']))
    expect(params.filter((p) => p === 'a')).toHaveLength(1)
    expect(result).toEqual({ success: true, data: { updated: 2 } })
  })

  it('rejects more than 100 ids and empty lists', async () => {
    state.body = { ids: Array.from({ length: 101 }, (_, i) => `m${i}`), status: 'seen' }
    await expect(bulkHandler({} as never)).rejects.toMatchObject({ statusCode: 400 })
    state.body = { ids: [], status: 'seen' }
    await expect(bulkHandler({} as never)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('requires marketing access', async () => {
    state.access = 'forbidden'
    await expect(bulkHandler({} as never)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('GET mentions', () => {
  it('requires marketing access', async () => {
    state.access = 'forbidden'
    await expect(listHandler({} as never)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns an empty inbox with site state when no site exists', async () => {
    state.site = null
    await expect(listHandler({} as never)).resolves.toMatchObject({
      data: { items: [], nextCursor: null, site: { exists: false, verified: false, termCount: 0 } },
    })
  })

  it('exposes canEscalate from the support gate', async () => {
    state.site = null
    state.canEscalate = true
    await expect(listHandler({} as never)).resolves.toMatchObject({ data: { canEscalate: true } })
    state.canEscalate = false
    await expect(listHandler({} as never)).resolves.toMatchObject({ data: { canEscalate: false } })
  })

  it('hides conversation and inbox ids for inboxes the caller cannot open', async () => {
    const row = (id: string, inbox: string | null) => ({
      id,
      status: inbox ? 'escalated' : 'new',
      publishedAt: new Date(),
      conversationId: inbox ? `conv-${id}` : null,
      conversationInboxId: inbox,
    })
    state.reachableInboxes = ['inbox-ok']
    state.selectQueue = [[row('a', 'inbox-ok'), row('b', 'inbox-secret'), row('c', null)], [], [{ total: 0 }]]
    const res = (await listHandler({} as never)) as { data: { items: Array<Record<string, unknown>> } }
    const [a, b, c] = res.data.items
    expect(a).toMatchObject({ conversationId: 'conv-a', conversationInboxId: 'inbox-ok' })
    expect(b).toMatchObject({ status: 'escalated', conversationId: null, conversationInboxId: null })
    expect(c).toMatchObject({ conversationId: null, conversationInboxId: null })
  })

  it('lists newest published first (published_at, id) and counts only the last 180 days', async () => {
    state.selectQueue = [[], [{ status: 'new', total: 2 }], [{ total: 1 }]]
    const res = (await listHandler({} as never)) as { data: { counts: Record<string, number> } }
    expect(res.data.counts.new).toBe(2)

    const order = state.calls.find((c) => c.op === 'orderBy')!
    const orderSql = order.args.map((a) => sqlOf(a).sql).join(' | ')
    expect(orderSql).toContain('"mention"."published_at" desc')
    expect(orderSql).toContain('"mention"."id" desc')

    // list query has no status condition by default; the counts query has the 180-day window
    const wheres = state.calls.filter((c) => c.op === 'where' && sqlOf(c.args[0]).sql.includes('"mention"."site_id"'))
    const [listWhere, countWhere] = wheres.map((c) => sqlOf(c.args[0]))
    expect(listWhere.sql).not.toContain('"mention"."status"')
    expect(countWhere.sql).toContain('"mention"."published_at" >=')
    const since = countWhere.params.find((p) =>
      p instanceof Date || typeof p === 'string'
        ? !Number.isNaN(Date.parse(String(p))) && String(p).includes('T')
        : false
    )
    const age = Date.now() - new Date(String(since)).getTime()
    expect(Math.abs(age - 180 * 24 * 60 * 60 * 1000)).toBeLessThan(60_000)
  })

  it('rejects an invalid cursor', async () => {
    state.query = { cursor: 'not-a-cursor!' }
    await expect(listHandler({} as never)).rejects.toMatchObject({ statusCode: 400 })
  })
})
