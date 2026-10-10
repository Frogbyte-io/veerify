import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  query: {} as Record<string, unknown>,
  authed: true,
  marketing: 'on' as 'on' | 'off' | 'forbidden',
  queue: [] as unknown[][],
  wheres: [] as unknown[],
  selects: 0,
}))

const httpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode, data: { error: { message } } })

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', (_e: unknown, name: string) => state.params[name])
vi.stubGlobal('getQuery', () => state.query)
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string }) =>
  Object.assign(new Error(input.statusMessage), input)
)

vi.mock('h3', () => ({
  getRouterParam: (_e: unknown, name: string) => state.params[name],
  createError: (input: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(input.statusMessage), input),
}))

vi.mock('~/server/utils/auth-middleware', () => ({
  requireAuth: vi.fn(async () => {
    if (!state.authed) throw httpError(401, 'Unauthorized')
    return { user: { id: 'u1' } }
  }),
}))

vi.mock('~/server/utils/marketing-access', () => ({
  requireMarketingAccess: vi.fn(async (projectId: string) => {
    if (state.marketing === 'forbidden') throw httpError(403, 'Forbidden')
    if (state.marketing === 'off') throw httpError(403, 'Marketing is not enabled')
    return { project: { id: projectId, teamId: 't1' }, teamId: 't1' }
  }),
}))

vi.mock('~/server/utils/response', () => ({
  createSuccessResponse: (data: unknown) => ({ success: true, data }),
  createErrorResponse: (code: string, message: string) => ({ success: false, error: { code, message } }),
  ErrorCode: {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    RATE_LIMITED: 'RATE_LIMITED',
  },
}))

vi.mock('~/server/services/marketing/visibility/progress', () => ({
  getRunProgress: vi.fn(async () => ({})),
  EMPTY_PROGRESS: { total: 0, pending: 0, done: 0, failed: 0 },
}))

vi.mock('~/server/database/drizzle', () => {
  const makeChain = () => {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.innerJoin = () => c
    c.orderBy = () => c
    c.where = (condition: unknown) => {
      state.wheres.push(condition)
      return c
    }
    c.limit = () => c
    c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(state.queue.shift() ?? []).then(resolve, reject)
    return c
  }
  return {
    db: {
      select: () => {
        state.selects++
        return makeChain()
      },
    },
  }
})

const site = { id: 'site-1', teamId: 't1', projectId: 'p1', origin: 'https://acme.com', verifiedAt: new Date() }

const runsGet = (await import('~/server/api/marketing/projects/[projectId]/visibility/runs/[runId].get')).default
const answersGet = (await import('~/server/api/marketing/projects/[projectId]/visibility/runs/[runId]/answers.get'))
  .default
const promptsGet = (await import('~/server/api/marketing/projects/[projectId]/visibility/prompts.get')).default
const promptDelete = (await import('~/server/api/marketing/projects/[projectId]/visibility/prompts/[promptId].delete'))
  .default

function sqlOf(condition: unknown) {
  return new PgDialect().sqlToQuery(condition as never)
}

const call = (handler: unknown) => (handler as (e: unknown) => Promise<unknown>)({} as never)

beforeEach(() => {
  state.params = { projectId: 'p1', runId: 'run-1', promptId: 'prompt-1' }
  state.query = {}
  state.authed = true
  state.marketing = 'on'
  state.queue = []
  state.wheres = []
  state.selects = 0
})

describe('visibility route authorization', () => {
  it.each([
    ['runs/[runId]', runsGet],
    ['runs/[runId]/answers', answersGet],
    ['prompts', promptsGet],
    ['prompts/[promptId] delete', promptDelete],
  ])('%s rejects unauthenticated requests', async (_name, handler) => {
    state.authed = false
    await expect(call(handler)).rejects.toMatchObject({ statusCode: 401 })
    expect(state.selects).toBe(0)
  })

  it.each([
    ['runs/[runId]', runsGet],
    ['runs/[runId]/answers', answersGet],
    ['prompts', promptsGet],
  ])('%s rejects when marketing is off or the user is not a member', async (_name, handler) => {
    state.marketing = 'off'
    await expect(call(handler)).rejects.toMatchObject({ statusCode: 403 })
    state.marketing = 'forbidden'
    await expect(call(handler)).rejects.toMatchObject({ statusCode: 403 })
    expect(state.selects).toBe(0)
  })

  it('returns 404 when the product has no marketing site', async () => {
    state.queue = [[]]
    await expect(call(promptsGet)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('run and answer cross-site protection', () => {
  it('scopes the run lookup to the product site and reads another site run as 404', async () => {
    state.queue = [[site], []] // site found, run not found for this site
    await expect(call(runsGet)).rejects.toMatchObject({ statusCode: 404 })

    const runWhere = sqlOf(state.wheres[1])
    expect(runWhere.params).toContain('run-1')
    expect(runWhere.params).toContain('site-1')
    expect(runWhere.sql).toContain('"site_id"')
  })

  it('never queries answers for a run that does not belong to the site', async () => {
    state.queue = [[site], []]
    await expect(call(answersGet)).rejects.toMatchObject({ statusCode: 404 })
    // site + run lookup only; no answers query
    expect(state.selects).toBe(2)
  })

  it('rejects a promptId from another site before reading answers', async () => {
    state.query = { promptId: 'foreign-prompt' }
    state.queue = [[site], [{ id: 'run-1', siteId: 'site-1' }], []]
    await expect(call(answersGet)).rejects.toMatchObject({ statusCode: 404 })
    expect(state.selects).toBe(3)

    const promptWhere = sqlOf(state.wheres[2])
    expect(promptWhere.params).toContain('foreign-prompt')
    expect(promptWhere.params).toContain('site-1')
  })

  it('returns answers for a run of the site', async () => {
    state.queue = [[site], [{ id: 'run-1', siteId: 'site-1' }], [{ id: 'a1', answer: 'text' }]]
    await expect(call(answersGet)).resolves.toEqual({
      success: true,
      data: { answers: [{ id: 'a1', answer: 'text' }] },
    })
  })

  it('does not delete a prompt that belongs to another site', async () => {
    state.queue = [[site], []]
    await expect(call(promptDelete)).rejects.toMatchObject({ statusCode: 404 })
    expect(sqlOf(state.wheres[1]).params).toContain('site-1')
  })
})
