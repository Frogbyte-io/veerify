import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ queue: [] as unknown[][], wheres: [] as unknown[] }))

vi.mock('~/server/database/drizzle', () => {
  const makeChain = () => {
    const c: Record<string, unknown> = {}
    for (const m of ['from', 'innerJoin', 'orderBy', 'limit']) c[m] = () => c
    c.where = (condition: unknown) => {
      state.wheres.push(condition)
      return c
    }
    c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(state.queue.shift() ?? []).then(resolve, reject)
    return c
  }
  return { db: { select: () => makeChain() } }
})

const { collectFeedbackItems, collectSupportItems, languageWindowStart } =
  await import('~/server/services/marketing/customer-language/collect')

const sqlOf = (c: unknown) => new PgDialect().sqlToQuery(c as never)

beforeEach(() => {
  state.queue = []
  state.wheres = []
})

describe('collectSupportItems', () => {
  const since = new Date('2026-07-12T00:00:00Z')
  const at = new Date('2026-10-01T00:00:00Z')

  it('scopes the query to incoming customer messages of this project within the window', async () => {
    state.queue = [[]]
    await collectSupportItems('proj-1', since)
    const q = sqlOf(state.wheres[0])
    expect(q.params).toEqual(expect.arrayContaining(['proj-1', 'incoming', 'contact', false, since.toISOString()]))
    expect(q.sql).toContain('"conversation"."project_id"')
  })

  it('keeps only incoming customer text and drops notes, agent replies and private rows', async () => {
    state.queue = [
      [
        {
          body: 'customer says exports are slow',
          kind: 'incoming',
          senderKind: 'contact',
          isPrivate: false,
          createdAt: at,
        },
        { body: 'internal note about the customer', kind: 'note', senderKind: 'agent', isPrivate: true, createdAt: at },
        { body: 'agent reply text', kind: 'outgoing', senderKind: 'agent', isPrivate: false, createdAt: at },
        { body: 'private incoming', kind: 'incoming', senderKind: 'contact', isPrivate: true, createdAt: at },
        { body: 'system activity', kind: 'activity', senderKind: 'system', isPrivate: false, createdAt: at },
        { body: null, kind: 'incoming', senderKind: 'contact', isPrivate: false, createdAt: at },
      ],
    ]
    const items = await collectSupportItems('proj-1', since)
    expect(items.map((i) => i.text)).toEqual(['customer says exports are slow'])
    expect(items[0].source).toBe('support')
  })
})

describe('collectFeedbackItems', () => {
  it('scopes feedback and public comments to the product and window', async () => {
    const since = new Date('2026-07-12T00:00:00Z')
    state.queue = [
      [{ title: 'Export is slow', body: 'It takes minutes', createdAt: new Date() }],
      [{ body: 'Same here', createdAt: new Date() }],
    ]
    const items = await collectFeedbackItems('proj-1', since)
    expect(items.map((i) => i.text)).toEqual(['Export is slow. It takes minutes', 'Same here'])
    const [postsQ, commentsQ] = state.wheres.map(sqlOf)
    expect(postsQ.params).toEqual(expect.arrayContaining(['proj-1', since.toISOString()]))
    expect(commentsQ.params).toEqual(expect.arrayContaining(['proj-1', false, since.toISOString()]))
    expect(commentsQ.sql).toContain('"is_internal"')
  })
})

describe('collectFeedbackItems privacy filters', () => {
  const since = new Date('2026-07-12T00:00:00Z')

  it('excludes hidden feedback and support-derived feedback (and their comments) by default', async () => {
    state.queue = [[], []]
    await collectFeedbackItems('proj-1', since)
    expect(state.wheres).toHaveLength(2)
    for (const where of state.wheres) {
      const q = sqlOf(where)
      expect(q.sql).toContain('"is_hidden"')
      expect(q.params).toContain(false)
      expect(q.sql).toContain("->>'source'")
      expect(q.sql).toContain('not ')
      expect(q.params).toContain('support_conversation')
    }
  })

  it('keeps hidden feedback out even with support consent, and labels support-derived rows as support', async () => {
    state.queue = [
      [
        { title: 'From chat', body: null, createdAt: new Date(), supportDerived: true },
        { title: 'Public post', body: null, createdAt: new Date(), supportDerived: false },
      ],
      [{ body: 'comment on chat feedback', createdAt: new Date(), supportDerived: true }],
    ]
    const items = await collectFeedbackItems('proj-1', since, { includeSupportDerived: true })
    expect(items.map((i) => i.source)).toEqual(['support', 'feedback', 'support'])
    for (const where of state.wheres) {
      const q = sqlOf(where)
      expect(q.sql).toContain('"is_hidden"')
      expect(q.sql).not.toContain('not coalesce')
    }
  })
})

describe('languageWindowStart', () => {
  it('is 90 days back', () => {
    const now = new Date('2026-10-10T00:00:00Z')
    expect(languageWindowStart(now).toISOString()).toBe('2026-07-12T00:00:00.000Z')
  })
})
