import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

const state = vi.hoisted(() => ({
  rows: [] as unknown[][],
  ops: [] as Array<{ op: string; args: unknown[] }>,
}))

function chain(): unknown {
  const target = function () {}
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(state.rows.shift() ?? []).then(resolve, reject)
      }
      return (...args: unknown[]) => {
        state.ops.push({ op: String(prop), args })
        return proxy
      }
    },
  })
  return proxy
}

const txCalls = vi.hoisted(() => ({ count: 0, failWith: null as Error | null }))
vi.mock('~/server/database/drizzle', () => {
  const db: Record<string, unknown> = {
    select: () => chain(),
    insert: () => chain(),
    update: () => chain(),
    delete: () => chain(),
    // The transaction runs against the same (mockable) db; a thrown error models a rollback
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      txCalls.count++
      return fn(db)
    },
  }
  return { db }
})

const teamModule = vi.hoisted(() => ({ enabled: true }))
vi.mock('~/server/utils/public-modules', () => ({
  isTeamModuleEnabled: vi.fn(async () => teamModule.enabled),
}))

vi.mock('h3', () => ({
  createError: (input: Record<string, unknown>) => Object.assign(new Error(String(input.statusMessage)), input),
}))

const loggerError = vi.hoisted(() => vi.fn())
vi.mock('~/server/utils/logger', () => ({ logger: { error: loggerError } }))

const { pickUniqueSlug, slugifyTitle } = await import('~/server/services/changelog/slug')
const { registerChangelogPublishedHook, runChangelogPublishedHooks, clearChangelogPublishedHooks } =
  await import('~/server/services/changelog/hooks')
const { createEntry, updateEntry, publishEntry, unpublishEntry } = await import('~/server/services/changelog/entries')
const { createEntrySchema, updateEntrySchema } = await import('~/server/services/changelog/schemas')
const { resolvePublicChangelogProject, listPublishedEntries, findPublishedEntryBySlug } =
  await import('~/server/services/changelog/public')

const publicProject = vi.hoisted(() => ({ value: { team: { id: 't1' }, project: { id: 'p1', settings: {} } } as any }))
vi.mock('~/server/utils/project-access', () => ({
  resolvePublicProjectByTeam: vi.fn(async (teamSlug: string) => {
    if (teamSlug === 'private') {
      throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
    }
    return publicProject.value
  }),
}))

const sqlOf = (value: unknown) => new PgDialect().sqlToQuery(value as any)

const draft = {
  id: 'e1',
  projectId: 'p1',
  title: 'Hello',
  slug: 'hello',
  summary: null,
  body: 'Some **body**',
  status: 'draft',
  labels: [],
  publishedAt: null,
  authorUserId: 'u1',
  createdAt: new Date(),
  updatedAt: new Date(),
}

beforeEach(() => {
  state.rows = []
  state.ops = []
  txCalls.count = 0
  teamModule.enabled = true
  loggerError.mockClear()
  clearChangelogPublishedHooks()
  publicProject.value = { team: { id: 't1' }, project: { id: 'p1', settings: { changelogEnabled: true } } }
})

describe('slug generation', () => {
  it('slugifies titles', () => {
    expect(slugifyTitle('Faster Search! (v2)')).toBe('faster-search-v2')
    expect(slugifyTitle('Ünïcode café')).toBe('unicode-cafe')
    expect(slugifyTitle('!!!')).toBe('update')
    expect(slugifyTitle('a'.repeat(100)).length).toBeLessThanOrEqual(60)
  })

  it('appends the next free numeric suffix on collision', () => {
    expect(pickUniqueSlug('news', new Set())).toBe('news')
    expect(pickUniqueSlug('news', new Set(['news']))).toBe('news-2')
    expect(pickUniqueSlug('news', new Set(['news', 'news-2', 'news-3']))).toBe('news-4')
  })

  it('createEntry uses a unique slug and retries a concurrent unique violation', async () => {
    // slug lookup (taken: hello) -> insert collides -> lookup (hello, hello-2) -> insert ok
    state.rows = [[{ slug: 'hello' }]]
    const insertError = Object.assign(new Error('dup'), { code: '23505' })
    let inserts = 0
    const { db } = await import('~/server/database/drizzle')
    const realInsert = db.insert
    ;(db as any).insert = () => {
      inserts++
      if (inserts === 1) {
        const failing: any = new Proxy(function () {}, {
          get: (_t, prop) => (prop === 'then' ? (_r: any, rej: any) => rej(insertError) : () => failing),
        })
        return failing
      }
      state.rows.unshift([{ ...draft, slug: 'hello-3' }])
      return (realInsert as any)()
    }
    // second slug lookup must be consumed before the insert result
    state.rows.push([{ slug: 'hello' }, { slug: 'hello-2' }])
    const row = await createEntry('p1', 'u1', { title: 'Hello' })
    expect(inserts).toBe(2)
    expect(row.slug).toBe('hello-3')
    ;(db as any).insert = realInsert
  })
})

describe('transactions', () => {
  it('createEntry writes the entry and its feedback links in one transaction', async () => {
    state.rows = [[{ id: 'f1' }], [], [draft]]
    await createEntry('p1', 'u1', { title: 'Hello', feedbackIds: ['f1'] })
    expect(txCalls.count).toBe(1)
    expect(state.ops.filter((o) => o.op === 'values')).toHaveLength(2)
  })

  it('updateEntry replaces linked feedback inside a transaction', async () => {
    state.rows = [[draft], [{ id: 'f1' }], [draft]]
    await updateEntry('p1', 'e1', { feedbackIds: ['f1'] })
    expect(txCalls.count).toBe(1)
  })
})

describe('validation', () => {
  it('accepts a valid entry and dedupes labels', () => {
    const parsed = createEntrySchema.parse({ title: ' T ', labels: ['new', 'new', 'fixed'], summary: 'ok' })
    expect(parsed.title).toBe('T')
    expect(parsed.labels).toEqual(['new', 'fixed'])
  })

  it('rejects bad input', () => {
    expect(createEntrySchema.safeParse({ title: '' }).success).toBe(false)
    expect(createEntrySchema.safeParse({ title: 'x', summary: 'a'.repeat(281) }).success).toBe(false)
    expect(createEntrySchema.safeParse({ title: 'x', body: 'a'.repeat(50_001) }).success).toBe(false)
    expect(createEntrySchema.safeParse({ title: 'x', labels: ['bogus'] }).success).toBe(false)
    expect(
      createEntrySchema.safeParse({ title: 'x', feedbackIds: Array.from({ length: 51 }, (_, i) => `f${i}`) }).success
    ).toBe(false)
    expect(updateEntrySchema.safeParse({ summary: 'a'.repeat(280), body: 'a'.repeat(50_000) }).success).toBe(true)
  })
})

describe('feedback link cross-project protection', () => {
  it('rejects create when a feedback id is not in the project', async () => {
    state.rows = [[{ id: 'f1' }]] // only one of two found
    await expect(createEntry('p1', 'u1', { title: 'T', feedbackIds: ['f1', 'other-project'] })).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(state.ops.some((o) => o.op === 'insert')).toBe(false)
  })

  it('rejects update when linking foreign feedback, without writing', async () => {
    state.rows = [[draft], []] // entry found, no feedback match
    await expect(updateEntry('p1', 'e1', { feedbackIds: ['foreign'] })).rejects.toMatchObject({ statusCode: 400 })
    expect(state.ops.some((o) => o.op === 'set')).toBe(false)
  })

  it('scopes the feedback lookup to the project', async () => {
    state.rows = [[draft], [{ id: 'f1' }], [{ ...draft }]]
    await updateEntry('p1', 'e1', { feedbackIds: ['f1'] })
    const where = state.ops.filter((o) => o.op === 'where')[1]
    const query = sqlOf(where.args[0])
    expect(query.sql).toContain('"project_id"')
    expect(query.params).toContain('p1')
  })

  it('404s for an entry of another project', async () => {
    state.rows = [[]]
    await expect(updateEntry('p1', 'nope', { title: 'x' })).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('publish / unpublish', () => {
  it('publishes a draft and runs hooks with the published row', async () => {
    const published = { ...draft, status: 'published', publishedAt: new Date() }
    state.rows = [[draft], [published]]
    const hook = vi.fn()
    registerChangelogPublishedHook(hook)
    const row = await publishEntry('p1', 'e1')
    expect(row.status).toBe('published')
    expect(hook).toHaveBeenCalledWith(published)
  })

  it('swallows and logs hook errors, still running the other hooks', async () => {
    const published = { ...draft, status: 'published', publishedAt: new Date() }
    state.rows = [[draft], [published]]
    const second = vi.fn()
    registerChangelogPublishedHook(async () => {
      throw new Error('boom')
    })
    registerChangelogPublishedHook(second)
    await expect(publishEntry('p1', 'e1')).resolves.toMatchObject({ status: 'published' })
    expect(second).toHaveBeenCalled()
    expect(loggerError).toHaveBeenCalled()
  })

  it('does not re-run hooks when already published', async () => {
    state.rows = [[{ ...draft, status: 'published', publishedAt: new Date() }]]
    const hook = vi.fn()
    registerChangelogPublishedHook(hook)
    await publishEntry('p1', 'e1')
    expect(hook).not.toHaveBeenCalled()
  })

  it('does not run hooks when a concurrent publish won the conditional update', async () => {
    const published = { ...draft, status: 'published', publishedAt: new Date() }
    // find (draft), conditional update matches nothing, re-find (published)
    state.rows = [[draft], [], [published]]
    const hook = vi.fn()
    registerChangelogPublishedHook(hook)
    const row = await publishEntry('p1', 'e1')
    expect(row.status).toBe('published')
    expect(hook).not.toHaveBeenCalled()
    const where = state.ops.filter((o) => o.op === 'where').map((o) => sqlOf(o.args[0]))
    expect(where.some((q) => q.params.includes('draft'))).toBe(true)
  })

  it('refuses to publish an empty entry', async () => {
    state.rows = [[{ ...draft, body: '  ', summary: null }]]
    await expect(publishEntry('p1', 'e1')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('unpublish returns the entry to draft', async () => {
    state.rows = [[{ ...draft, status: 'published', publishedAt: new Date() }], [{ ...draft }]]
    const row = await unpublishEntry('p1', 'e1')
    expect(row.status).toBe('draft')
    const set = state.ops.find((o) => o.op === 'set')
    expect(set?.args[0]).toMatchObject({ status: 'draft', publishedAt: null })
  })

  it('hook registration can be undone', async () => {
    const hook = vi.fn()
    const off = registerChangelogPublishedHook(hook)
    off()
    await runChangelogPublishedHooks(draft as any)
    expect(hook).not.toHaveBeenCalled()
  })
})

describe('public access', () => {
  it('404s when the product changelog toggle is off or unset', async () => {
    publicProject.value = { team: {}, project: { id: 'p1', settings: { changelogEnabled: false } } }
    await expect(resolvePublicChangelogProject('t', 'p')).rejects.toMatchObject({ statusCode: 404 })
    publicProject.value = { team: {}, project: { id: 'p1', settings: null } }
    await expect(resolvePublicChangelogProject('t', 'p')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('404s when the team-level changelog module is off', async () => {
    teamModule.enabled = false
    await expect(resolvePublicChangelogProject('t', 'p')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('propagates the private product error', async () => {
    await expect(resolvePublicChangelogProject('private', 'p')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('resolves when public and enabled', async () => {
    await expect(resolvePublicChangelogProject('t', 'p')).resolves.toMatchObject({ project: { id: 'p1' } })
  })

  it('only queries published entries of the project (drafts hidden)', async () => {
    state.rows = [[]]
    await listPublishedEntries('p1')
    const query = sqlOf(state.ops.find((o) => o.op === 'where')!.args[0])
    expect(query.params).toEqual(expect.arrayContaining(['p1', 'published']))
  })

  it('single entry lookup requires published status and 404s otherwise', async () => {
    state.rows = [[]]
    await expect(findPublishedEntryBySlug('p1', 'hello')).rejects.toMatchObject({ statusCode: 404 })
    const query = sqlOf(state.ops.find((o) => o.op === 'where')!.args[0])
    expect(query.params).toEqual(expect.arrayContaining(['p1', 'hello', 'published']))
  })

  it('renders sanitised html and hides hidden/support feedback', async () => {
    const published = {
      ...draft,
      status: 'published',
      publishedAt: new Date(),
      body: 'Hi <script>alert(1)</script> **there**',
    }
    state.rows = [
      [published],
      [
        { entryId: 'e1', id: 'f1', title: 'Public one', isHidden: false, metadata: null },
        { entryId: 'e1', id: 'f2', title: 'Hidden', isHidden: true, metadata: null },
        { entryId: 'e1', id: 'f3', title: 'Support', isHidden: false, metadata: { source: 'support_conversation' } },
      ],
    ]
    const { entries } = await listPublishedEntries('p1')
    expect(entries[0].html).toContain('<strong>there</strong>')
    expect(entries[0].html).not.toContain('<script')
    expect(entries[0].feedback).toEqual([{ id: 'f1', title: 'Public one' }])
  })
})
