import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableName } from 'drizzle-orm'

const state = vi.hoisted(() => ({
  updates: [] as { table: string; set: Record<string, unknown> }[],
  deleted: [] as string[],
  query: {} as Record<string, string>,
}))

vi.stubGlobal('defineEventHandler', (h: unknown) => h)
vi.stubGlobal('createError', (i: { statusCode: number }) => Object.assign(new Error('err'), i))
vi.stubGlobal('getRouterParam', (_e: unknown, n: string) => (n === 'slug' ? 'proj' : 'prod-a'))
vi.stubGlobal('getQuery', () => state.query)

const PRODUCTS = [
  { id: 'prod-a', projectId: 'proj-1' },
  { id: 'prod-b', projectId: 'proj-1' },
]

vi.mock('~/server/utils/project-categories', () => ({
  requireProjectBySlug: vi.fn(async () => ({ project: { id: 'proj-1' } })),
}))
vi.mock('~/server/utils/project-access', () => ({
  listProducts: vi.fn(async () => PRODUCTS),
  requireProductInProject: vi.fn(async (_p: string, id: string) => PRODUCTS.find((p) => p.id === id)),
}))
vi.mock('~/server/utils/response', () => ({
  createSuccessResponse: (data: unknown) => ({ success: true, data }),
  createErrorResponse: (code: string, message: string) => ({ success: false, error: { code, message } }),
  ErrorCode: { CONFLICT: 'CONFLICT', VALIDATION_ERROR: 'VALIDATION_ERROR' },
}))
vi.mock('~/server/database/drizzle', () => {
  const makeTx = () => {
    const select = () => {
      const chain: Record<string, unknown> = {}
      for (const m of ['from', 'where']) chain[m] = () => chain
      chain.then = (res: (v: unknown) => void) => Promise.resolve([{ count: 1 }]).then(res)
      return chain
    }
    return {
      select,
      insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
      update: (table: unknown) => ({
        set: (set: Record<string, unknown>) => {
          state.updates.push({ table: getTableName(table as never), set })
          return { where: () => ({ returning: async () => [{ id: 'fb-1' }] }) }
        },
      }),
      delete: (table: unknown) => ({
        where: async () => {
          state.deleted.push(getTableName(table as never))
        },
      }),
    }
  }
  const tx = makeTx()
  return { db: { select: tx.select, transaction: async (fn: (t: unknown) => unknown) => fn(tx) } }
})

const handler = (await import('~/server/api/projects/[slug]/products/[productId].delete')).default as (
  e: unknown
) => Promise<any>

beforeEach(() => {
  state.updates = []
  state.deleted = []
  state.query = {}
})

describe('DELETE product re-points app keys', () => {
  it('moves keys to the product the feedback moves to, before deleting', async () => {
    state.query = { moveTo: 'prod-b' }
    await handler({})
    const keyUpdate = state.updates.find((u) => u.table === 'project_api_key')
    expect(keyUpdate?.set).toEqual({ productId: 'prod-b' })
    const feedbackUpdate = state.updates.find((u) => u.table === 'feedback')
    expect(feedbackUpdate?.set).toEqual({ productId: 'prod-b' })
    expect(state.deleted).toEqual(['product'])
  })
})
