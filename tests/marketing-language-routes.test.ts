import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  role: 'admin' as 'admin' | 'member' | null,
  body: {} as unknown,
  upserts: [] as Array<Record<string, unknown>>,
  selectRows: [] as unknown[][],
  runCalls: 0,
  marketingAdmin: true,
  orgMismatch: false,
}))

const httpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode, data: { error: { message } } })

vi.stubGlobal('defineEventHandler', (h: unknown) => h)
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('createError', (i: { statusCode: number; statusMessage: string }) =>
  Object.assign(new Error(i.statusMessage), i)
)

vi.mock('h3', () => ({
  getRouterParam: (_e: unknown, n: string) => ({ projectId: 'p1' })[n],
  createError: (i: { statusCode: number; statusMessage: string }) => Object.assign(new Error(i.statusMessage), i),
}))
vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: async () => ({ user: { id: 'u1' } }),
}))
vi.mock('~/server/utils/project-context', () => ({
  requireAuthWithOrganization: async () => ({
    session: { user: { id: 'u1' } },
    organizationId: 'o1',
    organizationRole: state.role ?? 'member',
  }),
}))
vi.mock('~/server/utils/marketing-site', () => ({
  requireRouteParam: (_e: unknown, n: string) => ({ projectId: 'p1' })[n],
}))
vi.mock('~/server/utils/validation', () => ({
  validateBody: async (_e: unknown, schema: { parse: (v: unknown) => unknown }) => schema.parse(state.body),
}))
vi.mock('~/server/utils/project-access', () => ({
  requireOrganizationMember: async (organizationId: string) => {
    if (!state.role || organizationId !== 'o1' || state.orgMismatch) throw httpError(403, 'Forbidden')
    return state.role
  },
  requireOrganizationAdmin: async (organizationId: string) => {
    if (!state.role || organizationId !== 'o1' || state.orgMismatch) throw httpError(403, 'Forbidden')
    if (state.role !== 'admin') throw httpError(403, 'Forbidden')
    return state.role
  },
  isOrganizationAdminRole: (role: string | null) => role === 'admin' || role === 'owner',
}))
vi.mock('~/server/utils/response', () => ({
  createSuccessResponse: (data: unknown) => ({ success: true, data }),
  createErrorResponse: (code: string, message: string) => ({ error: { code, message } }),
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', CONFLICT: 'CONFLICT', RATE_LIMITED: 'RATE_LIMITED' },
}))
vi.mock('~/server/database/drizzle', () => {
  const chain = () => {
    const c: Record<string, unknown> = {}
    for (const m of ['from', 'leftJoin', 'where', 'limit']) c[m] = () => c
    c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(state.selectRows.shift() ?? []).then(resolve, reject)
    return c
  }
  return {
    db: {
      select: () => chain(),
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          onConflictDoUpdate: async () => {
            state.upserts.push(v)
          },
        }),
      }),
    },
  }
})
vi.mock('~/server/services/marketing/visibility/access', () => ({
  requireVisibilityRequest: async () => ({
    site: { id: 's1' },
    project: { id: 'p1', name: 'Acme' },
    organizationId: 'o1',
    userId: 'u1',
    projectId: 'p1',
  }),
}))
vi.mock('~/server/utils/marketing-access', () => ({
  requireMarketingAdmin: async () => {
    if (!state.marketingAdmin) throw httpError(403, 'Only project admins can manage Marketing settings')
  },
}))
vi.mock('~/server/services/marketing/customer-language/service', () => ({
  runCustomerLanguage: async () => {
    state.runCalls++
    return { id: 'i1' }
  },
}))

const getHandler = (await import('~/server/api/workspace/data-consent.get')).default
const putHandler = (await import('~/server/api/workspace/data-consent.put')).default
const runHandler = (await import('~/server/api/marketing/projects/[projectId]/language/runs.post')).default

const call = (h: unknown) => (h as (e: unknown) => Promise<{ data: Record<string, unknown> }>)({} as never)

beforeEach(() => {
  state.role = 'admin'
  state.body = { allowFeedbackText: true, allowSupportText: false }
  state.upserts = []
  state.selectRows = []
  state.runCalls = 0
  state.marketingAdmin = true
  state.orgMismatch = false
})

describe('data consent routes', () => {
  it('PUT is admin only', async () => {
    state.role = 'member'
    await expect(call(putHandler)).rejects.toMatchObject({ statusCode: 403 })
    expect(state.upserts).toHaveLength(0)
  })

  it('PUT records who and when, and a non-member is rejected', async () => {
    state.selectRows = [
      [], // previous consent, read by setConsent before the upsert
      [{ allowFeedbackText: true, allowSupportText: false, consentedAt: new Date(), consentedBy: 'Ann' }],
    ]
    const res = await call(putHandler)
    expect(state.upserts[0]).toMatchObject({
      organizationId: 'o1',
      allowFeedbackText: true,
      allowSupportText: false,
      consentedByUserId: 'u1',
    })
    expect(state.upserts[0].consentedAt).toBeInstanceOf(Date)
    expect(res.data).toMatchObject({ allowFeedbackText: true, consentedBy: 'Ann', canManage: true })
  })

  it('PUT rejects a non-boolean body', async () => {
    state.body = { allowFeedbackText: 'yes', allowSupportText: false }
    await expect(call(putHandler)).rejects.toBeTruthy()
    expect(state.upserts).toHaveLength(0)
  })

  it('cross-workspace: a user outside the workspace gets 403 on GET and PUT', async () => {
    state.role = null
    await expect(call(getHandler)).rejects.toMatchObject({ statusCode: 403 })
    await expect(call(putHandler)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('GET defaults to everything off and reports canManage', async () => {
    state.role = 'member'
    state.selectRows = [[]]
    const res = await call(getHandler)
    expect(res.data).toMatchObject({
      allowFeedbackText: false,
      allowSupportText: false,
      consentedBy: null,
      consentedAt: null,
      canManage: false,
    })
  })
})

describe('language run route', () => {
  it('requires marketing admin before running', async () => {
    state.marketingAdmin = false
    await expect(call(runHandler)).rejects.toMatchObject({ statusCode: 403 })
    expect(state.runCalls).toBe(0)
  })

  it('runs for an admin', async () => {
    await call(runHandler)
    expect(state.runCalls).toBe(1)
  })
})
