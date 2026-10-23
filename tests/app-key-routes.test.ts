import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  rows: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  whereArgs: [] as unknown[],
  updateResult: [] as Record<string, unknown>[],
  body: {} as unknown,
  status: undefined as number | undefined,
  access: null as null | { statusCode: number },
  params: {} as Record<string, string>,
}))

const requireProjectCategoryAccess = vi.hoisted(() =>
  vi.fn(async () => {
    if (state.access) throw Object.assign(new Error('x'), state.access)
    return { session: { user: { id: 'user-1' } }, project: { id: 'proj-1' } }
  })
)

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('getRouterParam', (_e: unknown, name: string) => state.params[name])
vi.stubGlobal('setResponseStatus', (_e: unknown, code: number) => {
  state.status = code
})

vi.mock('~/server/utils/project-categories', () => ({ requireProjectCategoryAccess }))
vi.mock('~/server/utils/response', () => ({
  createSuccessResponse: (data: unknown) => ({ success: true, data }),
  createErrorResponse: (code: string, message: string, details?: unknown) => ({
    success: false,
    error: { code, message, details },
  }),
  ErrorCode: { VALIDATION_ERROR: 'VALIDATION_ERROR', NOT_FOUND: 'NOT_FOUND' },
}))
vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: vi.fn((fields?: Record<string, unknown>) => {
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () =>
          Promise.resolve(
            state.rows.map((row) => (fields ? Object.fromEntries(Object.keys(fields).map((k) => [k, row[k]])) : row))
          ),
      }
      return chain
    }),
    insert: vi.fn(() => ({
      values: (v: Record<string, unknown>) => {
        state.inserted.push(v)
        return {
          returning: (fields: Record<string, unknown>) =>
            Promise.resolve([Object.fromEntries(Object.keys(fields).map((k) => [k, v[k] ?? null]))]),
        }
      },
    })),
    update: vi.fn(() => ({
      set: (v: Record<string, unknown>) => {
        state.updated.push(v)
        return {
          where: (arg: unknown) => {
            state.whereArgs.push(arg)
            return { returning: () => Promise.resolve(state.updateResult) }
          },
        }
      },
    })),
  },
}))

const listHandler = (await import('~/server/api/projects/[slug]/api-keys/index.get')).default as (
  e: unknown
) => Promise<any>
const createHandler = (await import('~/server/api/projects/[slug]/api-keys/index.post')).default as (
  e: unknown
) => Promise<any>
const deleteHandler = (await import('~/server/api/projects/[slug]/api-keys/[keyId].delete')).default as (
  e: unknown
) => Promise<any>
const { hashAppKey } = await import('~/server/utils/app-keys')

beforeEach(() => {
  state.inserted = []
  state.rows = []
  state.updated = []
  state.whereArgs = []
  state.updateResult = []
  state.body = {}
  state.status = undefined
  state.access = null
  state.params = { keyId: 'key-1' }
})

describe('app key routes', () => {
  it('list never exposes keyHash', async () => {
    state.rows = [
      {
        id: 'a',
        name: 'Dot X',
        keyPrefix: 'vfy_pub_abcd',
        keyHash: 'secret',
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
      },
    ]
    const res = await listHandler({})
    expect(res.data).toHaveLength(1)
    for (const item of res.data) {
      expect(item).not.toHaveProperty('keyHash')
      expect(item).toHaveProperty('keyPrefix', 'vfy_pub_abcd')
    }
  })

  it('create stores the hash, returns the key once, and never stores the key', async () => {
    state.body = { name: '  Dot X  ' }
    const res = await createHandler({})
    expect(state.status).toBe(201)
    const stored = state.inserted[0]
    expect(stored.name).toBe('Dot X')
    expect(stored.createdByUserId).toBe('user-1')
    expect(stored.projectId).toBe('proj-1')
    expect(stored.keyHash).toBe(hashAppKey(res.data.key))
    expect(Object.values(stored)).not.toContain(res.data.key)
    expect(stored).not.toHaveProperty('key')
    expect(res.data).not.toHaveProperty('keyHash')
    expect(res.data.key.startsWith('vfy_pub_')).toBe(true)
  })

  it('create rejects empty and over-long names', async () => {
    state.body = { name: '   ' }
    await expect(createHandler({})).rejects.toMatchObject({ statusCode: 400 })
    state.body = { name: 'x'.repeat(61) }
    await expect(createHandler({})).rejects.toMatchObject({ statusCode: 400 })
    expect(state.inserted).toHaveLength(0)
  })

  it('delete revokes a key in the project', async () => {
    state.updateResult = [{ id: 'key-1', revokedAt: new Date() }]
    const res = await deleteHandler({})
    expect(res.data.id).toBe('key-1')
    expect(state.updated[0].revokedAt).toBeInstanceOf(Date)
  })

  it('delete of a key from another project returns 404', async () => {
    state.updateResult = []
    await expect(deleteHandler({})).rejects.toMatchObject({ statusCode: 404 })
    // The update filter must constrain the key id, the resolved project id, and un-revoked state.
    const { sql, params } = new PgDialect().sqlToQuery(state.whereArgs[0] as SQL)
    expect(params).toEqual(expect.arrayContaining(['key-1', 'proj-1']))
    expect(sql).toContain('"project_api_key"."id" = $')
    expect(sql).toContain('"project_api_key"."project_id" = $')
  })

  it('delete does not re-revoke an already revoked key (filters on revokedAt IS NULL, 404)', async () => {
    state.updateResult = []
    await expect(deleteHandler({})).rejects.toMatchObject({ statusCode: 404 })
    const { sql } = new PgDialect().sqlToQuery(state.whereArgs[0] as SQL)
    expect(sql).toMatch(/"revoked_at" is null/)
  })

  it.each([
    ['list', () => listHandler({})],
    ['create', () => createHandler({})],
    ['delete', () => deleteHandler({})],
  ])('%s propagates 403 from requireProjectCategoryAccess', async (_n, run) => {
    state.access = { statusCode: 403 }
    await expect(run()).rejects.toMatchObject({ statusCode: 403 })
    expect(requireProjectCategoryAccess).toHaveBeenCalled()
  })
})
