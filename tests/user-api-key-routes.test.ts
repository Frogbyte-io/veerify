import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  rows: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  whereArgs: [] as unknown[],
  updateResult: [] as Record<string, unknown>[],
  activeCount: 0,
  body: {} as unknown,
  status: undefined as number | undefined,
  principal: false,
  params: {} as Record<string, string>,
}))

const requireInteractiveSession = vi.hoisted(() =>
  vi.fn(async (_event: unknown) => {
    if (state.principal) throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
    return { user: { id: 'user-1' } }
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

vi.mock('~/server/utils/auth-middleware', () => ({ requireInteractiveSession }))
vi.mock('~/server/utils/response', () => ({
  createSuccessResponse: (data: unknown) => ({ success: true, data }),
  createErrorResponse: (code: string, message: string, details?: unknown) => ({
    success: false,
    error: { code, message, details },
  }),
  ErrorCode: { VALIDATION_ERROR: 'VALIDATION_ERROR', NOT_FOUND: 'NOT_FOUND', CONFLICT: 'CONFLICT' },
}))
vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: vi.fn((fields?: Record<string, unknown>) => {
      const chain: any = {
        from: () => chain,
        where: (arg: unknown) => {
          state.whereArgs.push(arg)
          const result: any = Promise.resolve([{ count: state.activeCount }])
          result.orderBy = () =>
            Promise.resolve(
              state.rows.map((row) => (fields ? Object.fromEntries(Object.keys(fields).map((k) => [k, row[k]])) : row))
            )
          return result
        },
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

const listHandler = (await import('~/server/api/user/api-keys/index.get')).default as (e: unknown) => Promise<any>
const createHandler = (await import('~/server/api/user/api-keys/index.post')).default as (e: unknown) => Promise<any>
const deleteHandler = (await import('~/server/api/user/api-keys/[keyId].delete')).default as (
  e: unknown
) => Promise<any>
const { hashUserApiKey } = await import('~/server/utils/user-api-keys')

beforeEach(() => {
  state.inserted = []
  state.rows = []
  state.updated = []
  state.whereArgs = []
  state.updateResult = []
  state.activeCount = 0
  state.body = {}
  state.status = undefined
  state.principal = false
  state.params = { keyId: 'key-1' }
  requireInteractiveSession.mockClear()
})

describe('personal API key routes', () => {
  it('list never exposes keyHash or key, and scopes to the caller', async () => {
    state.rows = [
      {
        id: 'a',
        name: 'Agent',
        keyPrefix: 'vfy_usr_abcd',
        keyHash: 'secret',
        key: 'full',
        createdAt: new Date(),
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
      },
    ]
    const res = await listHandler({})
    expect(res.data).toHaveLength(1)
    expect(res.data[0]).not.toHaveProperty('keyHash')
    expect(res.data[0]).not.toHaveProperty('key')
    expect(res.data[0]).toHaveProperty('keyPrefix', 'vfy_usr_abcd')
    const { params } = new PgDialect().sqlToQuery(state.whereArgs[0] as SQL)
    expect(params).toContain('user-1')
  })

  it('create stores the hash, returns the key once, and never stores the key', async () => {
    state.body = { name: '  Agent  ' }
    const res = await createHandler({})
    expect(state.status).toBe(201)
    const stored = state.inserted[0]
    expect(stored.name).toBe('Agent')
    expect(stored.userId).toBe('user-1')
    expect(stored.expiresAt).toBeNull()
    expect(stored.keyHash).toBe(hashUserApiKey(res.data.key))
    expect(Object.values(stored)).not.toContain(res.data.key)
    expect(stored).not.toHaveProperty('key')
    expect(res.data).not.toHaveProperty('keyHash')
    expect(res.data.key.startsWith('vfy_usr_')).toBe(true)
  })

  it('create sets expiresAt from expiresInDays', async () => {
    state.body = { name: 'Agent', expiresInDays: 30 }
    const before = Date.now()
    await createHandler({})
    const exp = (state.inserted[0].expiresAt as Date).getTime()
    expect(exp).toBeGreaterThanOrEqual(before + 30 * 86400000)
    expect(exp).toBeLessThanOrEqual(Date.now() + 30 * 86400000)
  })

  it('create rejects invalid input', async () => {
    const bad = [
      { name: '   ' },
      { name: 'x'.repeat(61) },
      { name: 'a', expiresInDays: 0 },
      { name: 'a', expiresInDays: 366 },
      { name: 'a', expiresInDays: 1.5 },
    ]
    for (const body of bad) {
      state.body = body
      await expect(createHandler({})).rejects.toMatchObject({ statusCode: 400 })
    }
    expect(state.inserted).toHaveLength(0)
  })

  it('creating a 26th active key returns 409', async () => {
    state.activeCount = 25
    state.body = { name: 'Agent' }
    await expect(createHandler({})).rejects.toMatchObject({
      statusCode: 409,
      data: { error: { code: 'CONFLICT', message: 'You can have at most 25 active API keys' } },
    })
    expect(state.inserted).toHaveLength(0)
  })

  it('create allows the 25th key', async () => {
    state.activeCount = 24
    state.body = { name: 'Agent' }
    await createHandler({})
    expect(state.inserted).toHaveLength(1)
  })

  it('delete revokes the callers key', async () => {
    state.updateResult = [{ id: 'key-1', revokedAt: new Date() }]
    const res = await deleteHandler({})
    expect(res.data.id).toBe('key-1')
    expect(state.updated[0].revokedAt).toBeInstanceOf(Date)
  })

  it('delete of another user key or a revoked key returns 404 and filters on id, user and revokedAt', async () => {
    state.updateResult = []
    await expect(deleteHandler({})).rejects.toMatchObject({ statusCode: 404 })
    const { sql, params } = new PgDialect().sqlToQuery(state.whereArgs[0] as SQL)
    expect(params).toEqual(expect.arrayContaining(['key-1', 'user-1']))
    expect(sql).toContain('"user_api_key"."id" = $')
    expect(sql).toContain('"user_api_key"."user_id" = $')
    expect(sql).toMatch(/"revoked_at" is null/)
  })

  it.each([
    ['list', () => listHandler({})],
    ['create', () => createHandler({})],
    ['delete', () => deleteHandler({})],
  ])('%s rejects a key principal with 403', async (_n, run) => {
    state.principal = true
    await expect(run()).rejects.toMatchObject({ statusCode: 403 })
    expect(state.inserted).toHaveLength(0)
    expect(state.updated).toHaveLength(0)
  })
})
