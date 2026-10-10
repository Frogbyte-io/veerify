import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LAUNCH_DIRECTORIES, LAUNCH_DIRECTORY_CATEGORIES } from '~/server/services/marketing/launch-kit/directories'

const state = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  body: {} as unknown,
  selectQueue: [] as unknown[][],
  wheres: [] as unknown[],
  inserts: [] as Array<Record<string, any>>,
  updates: [] as Array<{ set: Record<string, any>; where: unknown }>,
  deleteRows: [] as unknown[],
  deleteWhere: null as unknown,
  access: 'ok' as 'ok' | 'forbidden',
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_e: unknown, name: string) => state.params[name])
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)

vi.mock('~/server/utils/team-context', () => ({
  requireAuthWithResolvedTeam: vi.fn(async () => ({ session: { user: { id: 'u1' } } })),
}))

vi.mock('~/server/utils/marketing-access', () => ({
  requireMarketingAccess: vi.fn(async () => {
    if (state.access === 'forbidden') throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
    return { project: {}, teamId: 't1' }
  }),
}))

vi.mock('~/server/database/drizzle', () => {
  const chain: Record<string, any> = {
    from: () => chain,
    where: (condition: unknown) => {
      state.wheres.push(condition)
      return chain
    },
    orderBy: () => chain,
    limit: () => chain,
    then: (resolve: (rows: unknown[]) => unknown) => resolve(state.selectQueue.shift() ?? []),
  }
  const db = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => ({
      values: (values: Record<string, any>) => {
        state.inserts.push(values)
        const result: Record<string, any> = {
          onConflictDoUpdate: () => result,
          returning: async () => [{ ...values }],
        }
        return result
      },
    })),
    update: vi.fn(() => ({
      set: (set: Record<string, any>) => ({
        where: (where: unknown) => {
          state.updates.push({ set, where })
          return { returning: async () => [{ id: 'row-1', directoryId: state.params.directoryId, ...set }] }
        },
      }),
    })),
    delete: vi.fn(() => ({
      where: (where: unknown) => {
        state.deleteWhere = where
        return { returning: async () => state.deleteRows }
      },
    })),
  }
  return { db }
})

const sqlOf = (condition: unknown) => new PgDialect().sqlToQuery(condition as never)

const getHandler = (await import('~/server/api/marketing/projects/[projectId]/launch-kit/index.get')).default
const putHandler = (await import('~/server/api/marketing/projects/[projectId]/launch-kit/[directoryId].put')).default
const deleteHandler = (await import('~/server/api/marketing/projects/[projectId]/launch-kit/[directoryId].delete'))
  .default
const customHandler = (await import('~/server/api/marketing/projects/[projectId]/launch-kit/custom.post')).default

const run = (handler: unknown) => (handler as (event: unknown) => Promise<any>)({})

const CUSTOM_ID = 'custom:11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  state.params = { projectId: 'p1', directoryId: 'product-hunt' }
  state.body = {}
  state.selectQueue = []
  state.wheres = []
  state.inserts = []
  state.updates = []
  state.deleteRows = []
  state.deleteWhere = null
  state.access = 'ok'
})

describe('launch kit catalog', () => {
  it('has unique ids and plausible size', () => {
    const ids = LAUNCH_DIRECTORIES.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThanOrEqual(25)
    for (const id of ids) expect(id).not.toMatch(/^custom:/)
  })

  it('uses https URLs, valid categories and pricing, and no tracking parameters', () => {
    for (const d of LAUNCH_DIRECTORIES) {
      for (const link of [d.url, d.submitUrl].filter(Boolean) as string[]) {
        const url = new URL(link)
        expect(url.protocol, d.id).toBe('https:')
        expect(url.search, d.id).toBe('')
      }
      expect(LAUNCH_DIRECTORY_CATEGORIES, d.id).toContain(d.category)
      expect(['free', 'paid', 'freemium'], d.id).toContain(d.pricing)
      expect(d.name.length, d.id).toBeGreaterThan(0)
      expect(d.audience.length, d.id).toBeGreaterThan(0)
      expect(d.tips.length, d.id).toBeGreaterThan(0)
    }
  })

  it('includes the well-known launch places', () => {
    const ids = LAUNCH_DIRECTORIES.map((d) => d.id)
    for (const id of ['product-hunt', 'hacker-news-show-hn', 'betalist', 'g2', 'capterra', 'alternativeto']) {
      expect(ids).toContain(id)
    }
  })
})

describe('launch kit routes: authorization', () => {
  it.each([
    ['GET', () => run(getHandler)],
    ['PUT', () => run(putHandler)],
    ['DELETE', () => run(deleteHandler)],
    ['POST custom', () => run(customHandler)],
  ])('%s returns 403 without marketing access', async (_name, call) => {
    state.access = 'forbidden'
    state.body = { status: 'live', name: 'X' }
    await expect(call()).rejects.toMatchObject({ statusCode: 403 })
    expect(state.inserts).toHaveLength(0)
    expect(state.updates).toHaveLength(0)
    expect(state.deleteWhere).toBeNull()
  })
})

describe('GET launch kit', () => {
  it('merges catalog with items and counts every entry by status', async () => {
    state.selectQueue = [
      [
        { directoryId: 'product-hunt', status: 'live', url: 'https://producthunt.com/p/x', notes: 'n', liveAt: null },
        { directoryId: 'betalist', status: 'submitted' },
        { directoryId: 'removed-from-catalog', status: 'live' },
        { directoryId: CUSTOM_ID, name: 'My dir', url: 'https://mydir.example', status: 'in_progress' },
      ],
    ]
    const { data } = await run(getHandler)

    const ph = data.directories.find((d: any) => d.id === 'product-hunt')
    expect(ph).toMatchObject({
      status: 'live',
      url: 'https://producthunt.com/p/x',
      siteUrl: 'https://www.producthunt.com',
    })
    expect(data.directories.find((d: any) => d.id === 'g2').status).toBe('todo')
    expect(data.custom).toEqual([expect.objectContaining({ id: CUSTOM_ID, name: 'My dir', status: 'in_progress' })])

    const total = LAUNCH_DIRECTORIES.length + 1
    expect(data.progress.total).toBe(total)
    expect(data.progress.counts).toMatchObject({ live: 1, submitted: 1, in_progress: 1, todo: total - 3 })
  })

  it('only reads items of the requested product', async () => {
    await run(getHandler)
    const query = sqlOf(state.wheres[0])
    expect(query.sql).toContain('"project_id"')
    expect(query.params).toEqual(['p1'])
  })
})

describe('PUT launch kit item', () => {
  it('rejects an invalid status, non-https URL, long URL and long notes', async () => {
    for (const body of [
      { status: 'done' },
      { status: 'live', url: 'http://example.com' },
      { status: 'live', url: 'javascript:alert(1)' },
      { status: 'live', url: `https://example.com/${'a'.repeat(500)}` },
      { status: 'live', notes: 'a'.repeat(1001) },
      {},
    ]) {
      state.body = body
      await expect(run(putHandler)).rejects.toMatchObject({ statusCode: 400 })
    }
    expect(state.inserts).toHaveLength(0)
  })

  it('accepts the boundary lengths', async () => {
    state.body = { status: 'live', url: `https://e.co/${'a'.repeat(500 - 13)}`, notes: 'a'.repeat(1000) }
    await expect(run(putHandler)).resolves.toMatchObject({ success: true })
  })

  it('returns 404 for unknown catalog ids and missing custom ids', async () => {
    state.body = { status: 'live' }
    state.params.directoryId = 'nope'
    await expect(run(putHandler)).rejects.toMatchObject({ statusCode: 404 })

    state.params.directoryId = CUSTOM_ID
    state.selectQueue = [[]]
    await expect(run(putHandler)).rejects.toMatchObject({ statusCode: 404 })
    expect(state.inserts).toHaveLength(0)
  })

  it('scopes the lookup to the project so another product custom id is not found', async () => {
    state.params.directoryId = CUSTOM_ID
    state.body = { status: 'live' }
    state.selectQueue = [[]]
    await expect(run(putHandler)).rejects.toMatchObject({ statusCode: 404 })
    const query = sqlOf(state.wheres[0])
    expect(query.sql).toContain('"project_id"')
    expect(query.sql).toContain('"directory_id"')
    expect(query.params).toEqual(['p1', CUSTOM_ID])
  })

  it('inserts a new item and sets submittedAt when it becomes submitted', async () => {
    state.body = { status: 'submitted', url: 'https://producthunt.com/p/x', notes: ' hi ' }
    state.selectQueue = [[]]
    const { data } = await run(putHandler)
    expect(state.inserts).toHaveLength(1)
    expect(state.inserts[0]).toMatchObject({
      projectId: 'p1',
      directoryId: 'product-hunt',
      status: 'submitted',
      notes: 'hi',
      liveAt: null,
      updatedByUserId: 'u1',
    })
    expect(state.inserts[0].submittedAt).toBeInstanceOf(Date)
    expect(data.item).toMatchObject({ id: 'product-hunt', status: 'submitted' })
  })

  it('sets liveAt on first live and keeps earlier timestamps', async () => {
    const submittedAt = new Date('2026-01-01')
    state.selectQueue = [
      [{ id: 'row-1', status: 'submitted', url: 'https://a.example', notes: 'keep', submittedAt, liveAt: null }],
    ]
    state.body = { status: 'live' }
    await run(putHandler)
    const set = state.updates[0].set
    expect(set.submittedAt).toBe(submittedAt)
    expect(set.liveAt).toBeInstanceOf(Date)
    // Omitted url and notes keep their values
    expect(set.url).toBe('https://a.example')
    expect(set.notes).toBe('keep')
  })

  it('does not overwrite an existing timestamp and clears url when null is sent', async () => {
    const liveAt = new Date('2026-02-02')
    state.selectQueue = [[{ id: 'row-1', status: 'live', url: 'https://a.example', submittedAt: null, liveAt }]]
    state.body = { status: 'live', url: null, notes: '' }
    await run(putHandler)
    const set = state.updates[0].set
    expect(set.liveAt).toBe(liveAt)
    expect(set.url).toBeNull()
    expect(set.notes).toBeNull()
  })

  it('does not set timestamps for other statuses', async () => {
    state.selectQueue = [[]]
    state.body = { status: 'in_progress' }
    await run(putHandler)
    expect(state.inserts[0].submittedAt).toBeNull()
    expect(state.inserts[0].liveAt).toBeNull()
  })

  it('updates an existing custom directory', async () => {
    state.params.directoryId = CUSTOM_ID
    state.selectQueue = [[{ id: 'row-1', directoryId: CUSTOM_ID, name: 'Mine', status: 'todo' }]]
    state.body = { status: 'rejected' }
    const { data } = await run(putHandler)
    expect(state.updates).toHaveLength(1)
    expect(state.inserts).toHaveLength(0)
    expect(data.item).toMatchObject({ id: CUSTOM_ID, custom: true, status: 'rejected' })
  })
})

describe('POST custom directory', () => {
  it('validates name and url', async () => {
    for (const body of [{}, { name: '   ' }, { name: 'a'.repeat(81) }, { name: 'ok', url: 'http://x.example' }]) {
      state.body = body
      await expect(run(customHandler)).rejects.toMatchObject({ statusCode: 400 })
    }
    expect(state.inserts).toHaveLength(0)
  })

  it('creates a custom item with a generated custom id', async () => {
    state.body = { name: ' Niche list ', url: 'https://niche.example/submit' }
    state.selectQueue = [[{ total: 29 }]]
    const { data } = await run(customHandler)
    expect(state.inserts[0]).toMatchObject({ projectId: 'p1', name: 'Niche list', status: 'todo' })
    expect(state.inserts[0].directoryId).toMatch(/^custom:[0-9a-f-]{36}$/)
    expect(data.item).toMatchObject({ custom: true, name: 'Niche list', siteUrl: 'https://niche.example/submit' })
  })

  it('caps custom directories at 30 per product', async () => {
    state.body = { name: 'One more' }
    state.selectQueue = [[{ total: 30 }]]
    await expect(run(customHandler)).rejects.toMatchObject({ statusCode: 400 })
    expect(state.inserts).toHaveLength(0)
    const query = sqlOf(state.wheres[0])
    expect(query.params).toEqual(['p1', 'custom:%'])
  })
})

describe('DELETE launch kit item', () => {
  it('resets a catalog directory by removing the row, even when none exists', async () => {
    const { data } = await run(deleteHandler)
    expect(data).toEqual({ deleted: false, reset: true })
    const query = sqlOf(state.deleteWhere)
    expect(query.params).toEqual(['p1', 'product-hunt'])
  })

  it('deletes a custom directory of this product', async () => {
    state.params.directoryId = CUSTOM_ID
    state.deleteRows = [{ id: 'row-1' }]
    const { data } = await run(deleteHandler)
    expect(data).toEqual({ deleted: true, reset: false })
    expect(sqlOf(state.deleteWhere).params).toEqual(['p1', CUSTOM_ID])
  })

  it('returns 404 for a custom id that is not in this product, or an unknown catalog id', async () => {
    state.params.directoryId = CUSTOM_ID
    await expect(run(deleteHandler)).rejects.toMatchObject({ statusCode: 404 })
    state.params.directoryId = 'nope'
    await expect(run(deleteHandler)).rejects.toMatchObject({ statusCode: 404 })
  })
})
