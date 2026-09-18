import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  whereConditions: [] as unknown[],
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', () => 'team-1')

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: 'admin-1' } })),
}))

vi.mock('~/server/utils/support-access', () => ({
  requireInboxAccess: vi.fn(),
  requireSupportTeamRole: vi.fn(async () => ({ effectiveRole: 'admin', isTeamAdmin: true })),
}))

vi.mock('~/server/utils/validation', () => ({
  validateQuery: vi.fn(() => ({})),
}))

vi.mock('~/server/utils/response', () => ({
  createSuccessResponse: (data: unknown) => ({ success: true, data }),
}))

vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: vi.fn(() => {
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        leftJoin: () => chain,
        where: (condition: unknown) => {
          state.whereConditions.push(condition)
          return Promise.resolve([])
        },
      }
      return chain
    }),
  },
}))

const handler = (await import('~/server/api/support/teams/[teamId]/csat-summary.get')).default

describe('CSAT summary route query scope', () => {
  beforeEach(() => {
    state.whereConditions.length = 0
  })

  it('keeps team-admin summary rows on inboxes owned by the requested team', async () => {
    await handler({} as never)

    expect(state.whereConditions).toHaveLength(1)
    const sql = new PgDialect().sqlToQuery(state.whereConditions[0] as never).sql
    expect(sql).toContain('"support_inbox"."team_id"')
  })
})
