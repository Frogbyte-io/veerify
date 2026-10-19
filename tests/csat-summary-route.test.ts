import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { csatResponse } from '~/server/database/schema/support'

const state = vi.hoisted(() => ({
  whereConditions: [] as unknown[],
  selectedFields: null as Record<string, unknown> | null,
  query: {} as Record<string, unknown>,
  reportingTimezone: undefined as string | undefined,
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', () => 'team-1')
vi.stubGlobal('getQuery', () => state.query)
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: 'admin-1' } })),
}))

vi.mock('~/server/utils/support-access', () => ({
  requireInboxAccess: vi.fn(),
  requireSupportTeamRole: vi.fn(async () => ({ effectiveRole: 'admin', isTeamAdmin: true })),
}))

vi.mock('~/server/utils/validation', () => ({
  validateQuery: vi.fn(() => state.query),
}))

vi.mock('~/server/utils/response', () => ({
  createSuccessResponse: (data: unknown) => ({ success: true, data }),
  createErrorResponse: (code: string, message: string) => ({ success: false, error: { code, message } }),
  ErrorCode: { VALIDATION_ERROR: 'VALIDATION_ERROR' },
}))

vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: vi.fn((fields?: Record<string, unknown>) => {
      state.selectedFields = fields ?? null
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        leftJoin: () => chain,
        where: (condition: unknown) => {
          state.whereConditions.push(condition)
          return Promise.resolve(state.reportingTimezone ? [{ reportingTimezone: state.reportingTimezone }] : [])
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
    state.selectedFields = null
    state.query = {}
    state.reportingTimezone = undefined
  })

  it('keeps team-admin summary rows on inboxes owned by the requested team', async () => {
    await handler({} as never)

    expect(state.whereConditions).toHaveLength(2)
    const sql = new PgDialect().sqlToQuery(state.whereConditions[1] as never).sql
    expect(sql).toContain('"support_inbox"."team_id"')
  })

  it('projects the immutable response scale for score normalization', async () => {
    await handler({} as never)

    expect(state.selectedFields?.scale).toBe(csatResponse.scale)
  })

  it('uses a 30-day inclusive default reporting window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-19T12:00:00.000Z'))

    try {
      const response = await handler({} as never)

      expect(response).toMatchObject({
        success: true,
        data: {
          from: new Date('2026-08-21T00:00:00.000Z'),
          to: new Date('2026-09-20T00:00:00.000Z'),
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns a bad-request error for a skipped local reporting date', async () => {
    state.query = {
      from: new Date('2011-12-30T00:00:00.000Z'),
      to: new Date('2011-12-30T00:00:00.000Z'),
    }
    state.reportingTimezone = 'Pacific/Apia'

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid reporting date range',
      data: {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid reporting date range',
        },
      },
    })
  })

  it('returns a bad-request error for a date outside the calendar range', async () => {
    state.query = {
      from: new Date('1899-12-31T00:00:00.000Z'),
      to: new Date('1900-01-01T00:00:00.000Z'),
    }

    await expect(handler({} as never)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid reporting date range',
      data: {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid reporting date range',
        },
      },
    })
  })
})
