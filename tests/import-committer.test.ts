import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory fake DB. Queries ignore `where` (fixtures hold one project and one run), inserts never conflict, and SQL
// expressions in `set` are not evaluated. Enough to drive a whole commit through every phase; the real semantics
// (conflicts, counters, scoping) are covered by tests/integration/imports-commit.test.ts.
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, any>[]>,
  claimRows: null as null | Record<string, any>[],
  claimWhere: [] as unknown[],
  calls: { select: 0, insert: 0, transaction: 0 },
}))

vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)

vi.mock('~/server/database/drizzle', async () => {
  const { getTableColumns: columnsOf, getTableName: nameOf, is: isA, SQL: Sql } = await import('drizzle-orm')
  const rowsOf = (table: any) => (state.tables[nameOf(table)] ??= [])
  const project = (table: any, fields: Record<string, any> | undefined, rows: Record<string, any>[]) => {
    if (!fields) return rows.map((r) => ({ ...r }))
    const keyByColumn = new Map(Object.entries(columnsOf(table)).map(([k, c]) => [c, k]))
    return rows.map((r) => Object.fromEntries(Object.entries(fields).map(([k, c]) => [k, r[keyByColumn.get(c)!]])))
  }
  const thenable = (chain: any, run: () => unknown) => {
    chain.then = (res: any, rej: any) => Promise.resolve().then(run).then(res, rej)
    return chain
  }
  const db: any = {
    select: (fields?: Record<string, any>) => {
      state.calls.select++
      let table: any
      let max = Infinity
      const chain: any = {
        from: (t: any) => ((table = t), chain),
        where: () => chain,
        orderBy: () => chain,
        for: () => chain,
        limit: (n: number) => ((max = n), chain),
      }
      return thenable(chain, () => project(table, fields, rowsOf(table).slice(0, max)))
    },
    insert: (table: any) => {
      state.calls.insert++
      let inserted: Record<string, any>[] = []
      let fields: Record<string, any> | undefined
      const chain: any = {
        values: (v: any) => {
          inserted = (Array.isArray(v) ? v : [v]).map((r) => ({ ...r }))
          rowsOf(table).push(...inserted)
          return chain
        },
        onConflictDoNothing: () => chain,
        returning: (f?: Record<string, any>) => ((fields = f), chain),
      }
      return thenable(chain, () => project(table, fields, inserted))
    },
    update: (table: any) => {
      let values: Record<string, any> = {}
      let fields: Record<string, any> | undefined
      let isClaim = false
      const chain: any = {
        set: (v: Record<string, any>) => ((values = v), chain),
        where: (w: unknown) => {
          if (
            nameOf(table) === 'import_run' &&
            'leaseUntil' in values &&
            values.leaseUntil !== null &&
            !values.status
          ) {
            isClaim = true
            state.claimWhere.push(w)
          }
          return chain
        },
        returning: (f?: Record<string, any>) => ((fields = f), chain),
      }
      return thenable(chain, () => {
        if (isClaim && state.claimRows) return state.claimRows
        const rows = rowsOf(table)
        for (const row of rows) for (const [k, v] of Object.entries(values)) if (!isA(v, Sql)) row[k] = v
        return project(table, fields, rows)
      })
    },
    delete: () => thenable({ where: () => ({}) }, () => []),
    transaction: async (cb: (tx: unknown) => unknown) => {
      state.calls.transaction++
      return cb(db)
    },
  }
  return { db }
})

const spyAll = vi.hoisted(() => async (load: () => Promise<Record<string, unknown>>) => {
  const mod = await load()
  return Object.fromEntries(Object.entries(mod).map(([k, v]) => [k, typeof v === 'function' ? vi.fn() : v]))
})
vi.mock('~/server/utils/notifications', (orig) => spyAll(orig as () => Promise<Record<string, unknown>>))
vi.mock('~/lib/email', (orig) => spyAll(orig as () => Promise<Record<string, unknown>>))
vi.mock('~/server/services/realtime', (orig) => spyAll(orig as () => Promise<Record<string, unknown>>))
vi.mock('~/server/services/changelog/hooks', (orig) => spyAll(orig as () => Promise<Record<string, unknown>>))
vi.mock('~/server/services/changelog/entries', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  publishEntry: vi.fn(),
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
}))
vi.mock('~/server/utils/support-auto-link', (orig) => spyAll(orig as () => Promise<Record<string, unknown>>))

import { advanceImportRun, commitImportRun } from '~/server/services/imports/committer'
import { importExample } from '~/server/services/imports/format'
import * as notifications from '~/server/utils/notifications'
import * as email from '~/lib/email'
import * as realtime from '~/server/services/realtime'
import * as hooks from '~/server/services/changelog/hooks'
import * as entries from '~/server/services/changelog/entries'
import * as autoLink from '~/server/utils/support-auto-link'

function seedRun(status: string, extra: Record<string, unknown> = {}) {
  const { format: _f, source: _s, sourceLabel: _l, target: _t, ...batch } = importExample()
  const run = {
    id: 'run-1',
    projectId: 'proj-1',
    productId: 'prod-1',
    createdByUserId: 'user-1',
    source: 'canny',
    sourceLabel: 'Canny',
    onExisting: 'sync',
    status,
    recordCount: 7,
    progress: null,
    summary: null,
    error: null,
    leaseUntil: null,
    committedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  }
  state.tables = {
    import_run: [run],
    import_run_batch: [{ id: 'b-1', runId: 'run-1', seq: 1, payload: batch, recordCount: 7, createdAt: new Date() }],
  }
  return run
}

beforeEach(() => {
  state.tables = {}
  state.claimRows = null
  state.claimWhere = []
  state.calls = { select: 0, insert: 0, transaction: 0 }
  vi.clearAllMocks()
})

describe('advanceImportRun lease (Review Focus 5)', () => {
  it('does no work when the lease cannot be claimed', async () => {
    seedRun('committing', { leaseUntil: new Date(Date.now() + 60_000) })
    state.claimRows = []
    expect(await advanceImportRun('run-1', { budgetMs: 20_000 })).toEqual({ done: false })
    expect(state.calls).toEqual({ select: 0, insert: 0, transaction: 0 })
  })

  it('claims with id, status committing and a free or expired lease', async () => {
    seedRun('committing')
    state.claimRows = []
    await advanceImportRun('run-1', { budgetMs: 20_000 })
    expect(state.claimWhere).toHaveLength(1)
    const { sql, params } = new PgDialect().sqlToQuery(state.claimWhere[0] as SQL)
    expect(sql).toBe(
      '("import_run"."id" = $1 and "import_run"."status" = $2 and ("import_run"."lease_until" is null or "import_run"."lease_until" < $3))'
    )
    expect(params.slice(0, 2)).toEqual(['run-1', 'committing'])
  })
})

describe('commitImportRun', () => {
  it('only commits drafts', async () => {
    seedRun('completed')
    await expect(commitImportRun('run-1')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('applies the example document inline without notifications, email, realtime or changelog hooks', async () => {
    seedRun('draft')
    const run = await commitImportRun('run-1')
    expect(run.status).toBe('completed')
    expect(state.tables.feedback).toHaveLength(1)
    expect(state.tables.vote).toHaveLength(2)
    expect(state.tables.feedback_comment).toHaveLength(1)
    expect(state.tables.changelog_entry).toHaveLength(1)
    expect(state.tables.changelog_entry[0]).toMatchObject({ status: 'published', authorUserId: null })
    expect(state.tables.feedback[0].authorUserId ?? null).toBeNull()
    expect(state.tables.feedback_subscription ?? []).toHaveLength(0)

    for (const mod of [notifications, email, realtime, hooks, entries, autoLink]) {
      for (const [name, fn] of Object.entries(mod)) {
        if (vi.isMockFunction(fn)) expect(fn, name).not.toHaveBeenCalled()
      }
    }
  })
})
