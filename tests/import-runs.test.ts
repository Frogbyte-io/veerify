import { PgDialect } from 'drizzle-orm/pg-core'
import { getTableName } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, any>[]>,
  body: {} as unknown,
  status: undefined as number | undefined,
  access: null as null | { statusCode: number },
  params: {} as Record<string, string>,
  products: [] as { id: string; slug: string; projectId: string }[],
  runUpdateMiss: false,
  batchInsertError: null as null | Record<string, unknown>,
}))

const requireProjectBySlug = vi.hoisted(() =>
  vi.fn(async (_event: unknown, _slug: string, _options?: { admin?: boolean }) => {
    if (state.access) throw Object.assign(new Error('x'), state.access)
    return { session: { user: { id: 'user-1' } }, project: { id: 'proj-1' } }
  })
)
const productLookup = vi.hoisted(() => ({
  requireProductInProject: vi.fn(async (_projectId: string, _id?: string | null) => ({ id: 'prod-default' })),
  listProducts: vi.fn(async (projectId: string) => state.products.filter((p) => p.projectId === projectId)),
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('getRouterParam', (_e: unknown, name: string) => state.params[name])
vi.stubGlobal('setResponseStatus', (_e: unknown, code: number) => {
  state.status = code
})

const readJsonBodyWithLimit = vi.hoisted(() => vi.fn(async (_event: unknown, _maxBytes: number) => state.body))
vi.mock('~/server/utils/json-body-limit', () => ({ readJsonBodyWithLimit }))
vi.mock('~/server/utils/project-categories', () => ({ requireProjectBySlug }))
vi.mock('~/server/utils/project-access', () => productLookup)
vi.mock('~/server/utils/response', () => ({
  createSuccessResponse: (data: unknown) => ({ success: true, data }),
  createErrorResponse: (code: string, message: string, details?: unknown) => ({
    success: false,
    error: { code, message, details },
  }),
  ErrorCode: { VALIDATION_ERROR: 'VALIDATION_ERROR', NOT_FOUND: 'NOT_FOUND', CONFLICT: 'CONFLICT' },
}))

const dialect = new PgDialect()
function matches(row: Record<string, any>, cond: SQL | undefined) {
  if (!cond) return true
  const { params } = dialect.sqlToQuery(cond)
  const values = Object.values(row)
  return params.every((p) => values.includes(p))
}

vi.mock('~/server/database/drizzle', () => {
  const rowsOf = (table: any) => (state.tables[getTableName(table)] ??= [])
  const db: any = {
    select: vi.fn(() => {
      let table: any
      let cond: SQL | undefined
      let max = Infinity
      const run = () =>
        rowsOf(table)
          .filter((r) => matches(r, cond))
          .slice(0, max)
      const chain: any = {
        from: (t: any) => ((table = t), chain),
        where: (c: SQL) => ((cond = c), chain),
        orderBy: () => chain,
        limit: (n: number) => ((max = n), chain),
        then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      }
      return chain
    }),
    insert: vi.fn((table: any) => ({
      values: (v: any) => {
        const list = Array.isArray(v) ? v : [v]
        if (state.batchInsertError && getTableName(table) === 'import_run_batch') throw state.batchInsertError
        rowsOf(table).push(...list)
        return {
          returning: () => Promise.resolve(list),
          then: (res: any, rej: any) => Promise.resolve(undefined).then(res, rej),
        }
      },
    })),
    delete: vi.fn((table: any) => ({
      where: (c: SQL) => {
        const rows = rowsOf(table)
        const keep = rows.filter((r) => !matches(r, c))
        rows.splice(0, rows.length, ...keep)
        return Promise.resolve(undefined)
      },
    })),
    update: vi.fn((table: any) => ({
      set: (v: any) => ({
        where: (c: SQL) => {
          const hit =
            state.runUpdateMiss && getTableName(table) === 'import_run' && 'recordCount' in v
              ? []
              : rowsOf(table).filter((r) => matches(r, c))
          hit.forEach((r) => Object.assign(r, v))
          return {
            returning: () => Promise.resolve(hit),
            then: (res: any, rej: any) => Promise.resolve(undefined).then(res, rej),
          }
        },
      }),
    })),
  }
  db.transaction = async (cb: (tx: any) => unknown) => {
    const snapshot = Object.fromEntries(
      Object.entries(state.tables).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))])
    )
    try {
      return await cb(db)
    } catch (error) {
      state.tables = snapshot
      throw error
    }
  }
  return { db }
})

const createHandler = (await import('~/server/api/projects/[slug]/imports/index.post')).default as (
  e: unknown
) => Promise<any>
const listHandler = (await import('~/server/api/projects/[slug]/imports/index.get')).default as (
  e: unknown
) => Promise<any>
const getHandler = (await import('~/server/api/projects/[slug]/imports/[runId].get')).default as (
  e: unknown
) => Promise<any>
const recordsHandler = (await import('~/server/api/projects/[slug]/imports/[runId]/records.post')).default as (
  e: unknown
) => Promise<any>
const cancelHandler = (await import('~/server/api/projects/[slug]/imports/[runId]/cancel.post')).default as (
  e: unknown
) => Promise<any>

const fb = (externalId: string) => ({ externalId, title: `T ${externalId}` })
const seedRun = (over: Record<string, any> = {}) => {
  const run = { id: 'run-1', projectId: 'proj-1', status: 'draft', recordCount: 0, ...over }
  ;(state.tables.import_run ??= []).push(run)
  return run
}

beforeEach(() => {
  state.tables = {}
  state.body = {}
  state.status = undefined
  state.runUpdateMiss = false
  state.batchInsertError = null
  state.access = null
  state.params = { slug: 'proj', runId: 'run-1' }
  state.products = [{ id: 'prod-x', slug: 'x-slug', projectId: 'proj-1' }]
  requireProjectBySlug.mockClear()
})

describe('import run routes', () => {
  it('non-admins get 403 on all five routes', async () => {
    state.access = { statusCode: 403 }
    state.body = { source: 'canny', sourceLabel: 'Canny' }
    for (const h of [createHandler, listHandler, getHandler, recordsHandler, cancelHandler]) {
      await expect(h({})).rejects.toMatchObject({ statusCode: 403 })
    }
    expect(requireProjectBySlug).toHaveBeenCalledTimes(5)
    for (const call of requireProjectBySlug.mock.calls) expect(call[2]).toEqual({ admin: true })
  })

  it('create stores the default product when product is omitted', async () => {
    state.body = { source: 'canny', sourceLabel: 'Canny' }
    const res = await createHandler({})
    expect(state.status).toBe(201)
    expect(res.data).toMatchObject({
      projectId: 'proj-1',
      productId: 'prod-default',
      source: 'canny',
      onExisting: 'sync',
      status: 'draft',
      createdByUserId: 'user-1',
    })
  })

  it('create resolves a product by slug and 404s for unknown ones', async () => {
    state.body = { source: 'canny', sourceLabel: 'Canny', product: 'x-slug', onExisting: 'skip' }
    const res = await createHandler({})
    expect(res.data).toMatchObject({ productId: 'prod-x', onExisting: 'skip' })
    state.body = { source: 'canny', sourceLabel: 'Canny', product: 'nope' }
    await expect(createHandler({})).rejects.toMatchObject({ statusCode: 404 })
  })

  it('create rejects a bad source', async () => {
    state.body = { source: 'Bad Source', sourceLabel: 'x' }
    await expect(createHandler({})).rejects.toMatchObject({ statusCode: 400 })
  })

  it('records rejects format/target keys with a hint', async () => {
    seedRun()
    state.body = { format: 'veerify-import/1', feedback: [] }
    await expect(recordsHandler({})).rejects.toMatchObject({
      statusCode: 400,
      data: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Send format and target to create the run; records batches carry only sections',
        },
      },
    })
  })

  it('records rejects source/sourceLabel keys and reads the body with the 4 MiB cap', async () => {
    seedRun()
    state.body = { source: 'canny', feedback: [] }
    await expect(recordsHandler({})).rejects.toMatchObject({ statusCode: 400 })
    expect(readJsonBodyWithLimit).toHaveBeenLastCalledWith({}, 4 * 1024 * 1024)
  })

  it('records rejects an unknown section instead of dropping it', async () => {
    seedRun()
    state.body = { feedback: [fb('f1')], comment: [{ externalId: 'c1', feedbackExternalId: 'f1', body: 'x' }] }
    await expect(recordsHandler({})).rejects.toMatchObject({
      statusCode: 400,
      data: { error: { code: 'VALIDATION_ERROR', message: expect.stringContaining('"comment"') } },
    })
  })

  it('records passes a 413 from the body reader through', async () => {
    seedRun()
    readJsonBodyWithLimit.mockRejectedValueOnce(Object.assign(new Error('Payload Too Large'), { statusCode: 413 }))
    await expect(recordsHandler({})).rejects.toMatchObject({ statusCode: 413 })
  })

  it('rejects a 1,001-record batch', async () => {
    seedRun()
    state.body = { feedback: Array.from({ length: 1001 }, (_, i) => fb(`f${i}`)) }
    await expect(recordsHandler({})).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a batch that pushes the run over 50,000', async () => {
    seedRun({ recordCount: 49_500 })
    state.body = { feedback: Array.from({ length: 501 }, (_, i) => fb(`f${i}`)) }
    await expect(recordsHandler({})).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects adding to a completed run with 409', async () => {
    seedRun({ status: 'completed' })
    state.body = { feedback: [fb('a')] }
    await expect(recordsHandler({})).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: { error: { code: 'CONFLICT' } },
    })
  })

  it('409s and commits nothing when the conditional run update matches no row', async () => {
    seedRun()
    state.runUpdateMiss = true
    state.body = { feedback: [fb('a'), fb('a')] }
    await expect(recordsHandler({})).rejects.toMatchObject({
      statusCode: 409,
      data: { error: { code: 'CONFLICT', message: 'Run changed concurrently; retry the batch' } },
    })
    expect(state.tables.import_run_batch ?? []).toHaveLength(0)
    expect(state.tables.import_run_issue ?? []).toHaveLength(0)
  })

  it('turns a (runId, seq) unique violation into a 409', async () => {
    seedRun()
    state.batchInsertError = { code: '23505' }
    state.body = { feedback: [fb('a')] }
    await expect(recordsHandler({})).rejects.toMatchObject({
      statusCode: 409,
      data: { error: { code: 'CONFLICT', message: 'Run changed concurrently; retry the batch' } },
    })
    expect(state.tables.import_run![0]!.recordCount).toBe(0)
  })

  it('stages a batch and increments seq and recordCount', async () => {
    const run = seedRun()
    state.body = { feedback: [fb('a'), fb('b')] }
    const first = await recordsHandler({})
    expect(state.status).toBe(201)
    expect(first.data).toEqual({ seq: 1, recordCount: 2, runRecordCount: 2, issues: [] })
    state.body = { feedback: [fb('c')] }
    const second = await recordsHandler({})
    expect(second.data).toMatchObject({ seq: 2, runRecordCount: 3 })
    expect(run.recordCount).toBe(3)
    expect(state.tables.import_run_batch).toHaveLength(2)
    expect(state.tables.import_run_batch![0]!.payload.comments).toEqual([])
  })

  it('drops a duplicate externalId across batches and records a skipped issue', async () => {
    seedRun()
    state.body = { feedback: [fb('a')] }
    await recordsHandler({})
    state.body = { feedback: [fb('a'), fb('b')] }
    const res = await recordsHandler({})
    expect(res.data.recordCount).toBe(1)
    expect(res.data.runRecordCount).toBe(2)
    expect(res.data.issues).toEqual([
      expect.objectContaining({ severity: 'skipped', entityType: 'feedback', externalId: 'a' }),
    ])
    expect(state.tables.import_run_batch![1]!.payload.feedback.map((f: any) => f.externalId)).toEqual(['b'])
    expect(state.tables.import_run_issue).toHaveLength(1)
    expect(state.tables.import_run_issue![0]).toMatchObject({ runId: 'run-1', severity: 'skipped' })
  })

  it('drops a duplicate externalId inside one batch', async () => {
    seedRun()
    state.body = { feedback: [fb('a'), fb('a')] }
    const res = await recordsHandler({})
    expect(res.data.recordCount).toBe(1)
    expect(res.data.issues).toHaveLength(1)
  })

  it('cancel on a completed run is 409; on a draft it cancels', async () => {
    seedRun({ status: 'completed' })
    await expect(cancelHandler({})).rejects.toMatchObject({ statusCode: 409 })
    state.tables.import_run![0]!.status = 'draft'
    ;(state.tables.import_run_batch ??= []).push({ id: 'b1', runId: 'run-1', seq: 1, payload: {} })
    const res = await cancelHandler({})
    expect(res.data.status).toBe('canceled')
    // Staged records hold personal data: canceling drops them
    expect(state.tables.import_run_batch).toEqual([])
  })

  it('get returns run and issues; another project is 404', async () => {
    seedRun()
    ;(state.tables.import_run_issue ??= []).push({ id: 'i1', runId: 'run-1', severity: 'warning', message: 'm' })
    const res = await getHandler({})
    expect(res.data.run.id).toBe('run-1')
    expect(res.data.issues).toHaveLength(1)
    state.tables.import_run![0]!.projectId = 'proj-2'
    await expect(getHandler({})).rejects.toMatchObject({ statusCode: 404 })
    await expect(cancelHandler({})).rejects.toMatchObject({ statusCode: 404 })
    state.body = { feedback: [fb('a')] }
    await expect(recordsHandler({})).rejects.toMatchObject({ statusCode: 404 })
  })

  it('list returns runs', async () => {
    seedRun()
    const res = await listHandler({})
    expect(res.data).toHaveLength(1)
  })
})
