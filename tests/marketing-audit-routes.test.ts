import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  site: { id: 'site-1', projectId: 'p1', origin: 'https://example.com', verifiedAt: new Date() } as unknown,
  audit: { id: 'a1', siteId: 'site-1', status: 'done' } as unknown,
  selects: 0,
  auditWhere: undefined as unknown,
  accessError: null as null | { statusCode: number },
  started: [] as unknown[],
  cancelled: [] as string[],
}))

const httpError = (statusCode: number) => Object.assign(new Error(String(statusCode)), { statusCode })

vi.stubGlobal('defineEventHandler', (h: unknown) => h)
vi.stubGlobal('getRouterParam', (_e: unknown, name: string) => (name === 'projectId' ? 'p1' : 'a1'))
vi.stubGlobal('setResponseStatus', () => undefined)
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string }) =>
  Object.assign(new Error(input.statusMessage), input)
)

vi.mock('~/server/utils/auth-middleware', () => ({ requireAuth: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('~/server/utils/marketing-access', () => ({
  requireMarketingAccess: vi.fn(async () => {
    if (state.accessError) throw httpError(state.accessError.statusCode)
    return { project: { id: 'p1' }, teamId: 't1' }
  }),
}))
vi.mock('~/server/utils/response', () => ({
  createSuccessResponse: (data: unknown) => ({ success: true, data }),
  createErrorResponse: (code: string, message: string) => ({ success: false, error: { code, message } }),
  ErrorCode: { NOT_FOUND: 'NOT_FOUND', FORBIDDEN: 'FORBIDDEN', CONFLICT: 'CONFLICT' },
}))
vi.mock('~/server/services/marketing/audit/runner', () => ({
  startAudit: vi.fn(async (input: unknown) => {
    state.started.push(input)
    return { id: 'new', mode: 'basic' }
  }),
  cancelAudit: vi.fn(async (id: string) => {
    state.cancelled.push(id)
    return true
  }),
  getAuditStartStatus: vi.fn(),
}))
vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: vi.fn(() => {
      const n = state.selects++
      const chain = {
        from: () => chain,
        where: (cond: unknown) => {
          if (n % 2 === 1) state.auditWhere = cond
          return chain
        },
        limit: () => Promise.resolve(n % 2 === 0 ? (state.site ? [state.site] : []) : state.audit ? [state.audit] : []),
      }
      return chain
    }),
  },
}))

const { requireAuditAccess } = await import('~/server/utils/marketing-audit-access')
const startRoute = (await import('~/server/api/marketing/projects/[projectId]/audits/index.post')).default as (
  e: unknown
) => Promise<unknown>
const cancelRoute = (await import('~/server/api/marketing/projects/[projectId]/audits/[auditId]/cancel.post'))
  .default as (e: unknown) => Promise<unknown>

beforeEach(() => {
  state.site = { id: 'site-1', projectId: 'p1', origin: 'https://example.com', verifiedAt: new Date() }
  state.audit = { id: 'a1', siteId: 'site-1', status: 'done' }
  state.selects = 0
  state.accessError = null
  state.started = []
  state.cancelled = []
})

describe('requireAuditAccess', () => {
  it('scopes the audit lookup to the product site, so another product audit reads as 404', async () => {
    await requireAuditAccess('p1', 'a1', 'u1')
    const sql = new PgDialect().sqlToQuery(state.auditWhere as never)
    expect(sql.sql).toContain('"seo_audit"."site_id"')
    expect(sql.params).toContain('site-1')
    expect(sql.params).toContain('a1')

    state.selects = 0
    state.audit = null // not found within this site
    await expect(requireAuditAccess('p1', 'foreign-audit', 'u1')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('404s when the product has no site', async () => {
    state.site = null
    await expect(requireAuditAccess('p1', 'a1', 'u1')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('propagates marketing access failures before touching audits', async () => {
    state.accessError = { statusCode: 403 }
    await expect(requireAuditAccess('p1', 'a1', 'u1')).rejects.toMatchObject({ statusCode: 403 })
    expect(state.selects).toBe(0)
  })
})

describe('audit routes', () => {
  it('start: requires a site, then starts a manual audit for the caller', async () => {
    const result = (await startRoute({})) as { data: { id: string } }
    expect(result.data.id).toBe('new')
    expect(state.started).toEqual([{ siteId: 'site-1', trigger: 'manual', userId: 'u1' }])
  })

  it('start: 403 without a site and for non-members', async () => {
    state.site = null
    await expect(startRoute({})).rejects.toMatchObject({ statusCode: 403 })
    state.accessError = { statusCode: 403 }
    await expect(startRoute({})).rejects.toMatchObject({ statusCode: 403 })
    expect(state.started).toHaveLength(0)
  })

  it('cancel: refuses finished audits and cancels active ones', async () => {
    await expect(cancelRoute({})).rejects.toMatchObject({ statusCode: 409 })
    state.selects = 0
    state.audit = { id: 'a1', siteId: 'site-1', status: 'crawling' }
    await cancelRoute({})
    expect(state.cancelled).toEqual(['a1'])
  })
})
