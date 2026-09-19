import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  body: {} as Record<string, unknown>,
  settings: [] as unknown[],
  values: null as Record<string, unknown> | null,
  conflictSet: null as Record<string, unknown> | null,
  updated: {
    teamId: 'team-1',
    autoLinkFeedback: false,
    reportingTimezone: 'UTC',
    createdAt: new Date('2026-09-18T00:00:00Z'),
    updatedAt: new Date('2026-09-18T00:00:00Z'),
  },
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', () => 'team-1')
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('createError', (input: Record<string, unknown>) =>
  Object.assign(new Error(String(input.statusMessage)), input)
)

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: 'admin-1' } })),
}))

vi.mock('~/server/utils/support-access', () => ({
  requireTeamAdmin: vi.fn(async () => ({ id: 'member-1', role: 'admin' })),
  resolveSupportTeamRole: vi.fn(async () => ({ effectiveRole: 'admin', isTeamAdmin: true })),
  capabilitiesForRole: vi.fn(() => ({ canManageTeamSupport: true })),
}))

vi.mock('~/server/utils/contact-lock', () => ({
  lockContactTeam: vi.fn(async () => undefined),
}))

vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => state.settings,
        }),
      }),
    }),
    transaction: async (...args: [unknown]) =>
      (args[0] as CallableFunction)({
        insert: () => ({
          values: (values: Record<string, unknown>) => {
            state.values = values
            return {
              onConflictDoUpdate: (input: { set?: Record<string, unknown> }) => {
                state.conflictSet = input.set ?? null
                return {
                  returning: async () => [{ ...state.updated, ...input.set, ...values }],
                }
              },
            }
          },
        }),
      }),
  },
}))

const getHandler = (await import('~/server/api/support/teams/[teamId]/settings.get')).default
const putHandler = (await import('~/server/api/support/teams/[teamId]/settings.put')).default

describe('support reporting timezone settings', () => {
  beforeEach(() => {
    state.body = {}
    state.settings = []
    state.values = null
    state.conflictSet = null
  })

  it('returns UTC when a team has no support settings row', async () => {
    const result = (await getHandler({} as never)) as { data: { settings: Record<string, unknown> } }

    expect(result.data.settings).toMatchObject({
      teamId: 'team-1',
      autoLinkFeedback: false,
      reportingTimezone: 'UTC',
    })
  })

  it('accepts an IANA timezone while retaining auto-link compatibility', async () => {
    state.body = { autoLinkFeedback: true, reportingTimezone: 'Pacific/Apia' }

    const result = (await putHandler({} as never)) as { data: { settings: Record<string, unknown> } }

    expect(result.data.settings).toMatchObject({ autoLinkFeedback: true, reportingTimezone: 'Pacific/Apia' })
    expect(state.values).toMatchObject({ autoLinkFeedback: true, reportingTimezone: 'Pacific/Apia' })
  })

  it('keeps the UTC default for clients that only send auto-link settings', async () => {
    state.body = { autoLinkFeedback: false }

    await putHandler({} as never)

    expect(state.values).toMatchObject({ autoLinkFeedback: false, reportingTimezone: 'UTC' })
    expect(state.conflictSet).not.toHaveProperty('reportingTimezone')
  })

  it('rejects an invalid timezone before writing settings', async () => {
    state.body = { autoLinkFeedback: true, reportingTimezone: 'Not/AZone' }

    await expect(putHandler({} as never)).rejects.toMatchObject({ statusCode: 400 })
  })
})
