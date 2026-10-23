import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  key: null as Record<string, unknown> | null,
  body: {} as unknown,
  status: undefined as number | undefined,
  headers: {} as Record<string, string>,
}))

const KEY = { id: 'key-1', projectId: 'proj-1', name: 'Dot X' }

const requireRateLimit = vi.hoisted(() => vi.fn(async () => undefined))
const notifyProjectTeam = vi.hoisted(() => vi.fn())

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('setResponseStatus', (_e: unknown, code: number) => {
  state.status = code
})
vi.stubGlobal('setResponseHeaders', (_e: unknown, headers: Record<string, string>) => {
  Object.assign(state.headers, headers)
})
vi.stubGlobal('getRequestURL', (e: { path: string }) => new URL(e.path, 'http://localhost'))

vi.mock('~/server/utils/rate-limit', () => ({
  requireRateLimit,
  rateLimits: { strict: { maxRequests: 5, windowSeconds: 60 } },
}))
vi.mock('~/server/utils/notifications', () => ({ notifyProjectTeam }))
vi.mock('~/server/utils/logger', () => ({ createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }))
vi.mock('~/server/utils/response', () => ({
  createSuccessResponse: (data: unknown) => ({ success: true, data }),
  createErrorResponse: (code: string, message: string, details?: unknown) => ({
    success: false,
    error: { code, message, details },
  }),
  ErrorCode: { VALIDATION_ERROR: 'VALIDATION_ERROR', UNAUTHORIZED: 'UNAUTHORIZED' },
}))
vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: vi.fn(() => {
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: () => Promise.resolve(state.key ? [state.key] : []),
      }
      return chain
    }),
    insert: vi.fn(() => ({
      values: (v: Record<string, unknown>) => {
        state.inserted.push(v)
        return Promise.resolve()
      },
    })),
    update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
  },
}))

const handler = (await import('~/server/api/v1/feedback.post')).default as (e: unknown) => Promise<any>
const cors = (await import('~/server/middleware/api-v1-cors')).default as (e: unknown) => unknown

function makeEvent(authorization?: string, extra: Record<string, unknown> = {}) {
  return {
    path: '/api/v1/feedback',
    method: 'POST',
    node: { req: { headers: authorization ? { authorization } : {} } },
    ...extra,
  }
}

const validBody = {
  type: 'bug',
  description: 'Slider jumps\nwhen I drag it',
  appVersion: '2.0.0-1',
  os: 'windows',
  osVersion: '10.0.26200',
}

describe('POST /api/v1/feedback', () => {
  beforeEach(() => {
    state.inserted.length = 0
    state.key = { ...KEY }
    state.body = { ...validBody }
    state.status = undefined
    state.headers = {}
    requireRateLimit.mockClear()
    notifyProjectTeam.mockClear()
  })

  it('rejects requests without an app key', async () => {
    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 401 })
    expect(state.inserted).toHaveLength(0)
  })

  it('rejects a revoked key', async () => {
    state.key = null
    await expect(handler(makeEvent('Bearer vfy_pub_revoked'))).rejects.toMatchObject({ statusCode: 401 })
    expect(state.inserted).toHaveLength(0)
  })

  it('rejects a whitespace-only description', async () => {
    state.body = { ...validBody, description: '   \n  ' }
    await expect(handler(makeEvent('Bearer vfy_pub_abc'))).rejects.toMatchObject({ statusCode: 400 })
    expect(state.inserted).toHaveLength(0)
  })

  it('creates feedback marked with the key name', async () => {
    const result = await handler(makeEvent('Bearer vfy_pub_abc'))

    expect(state.status).toBe(201)
    expect(result.success).toBe(true)
    expect(typeof result.data.id).toBe('string')
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted[0]).toMatchObject({
      id: result.data.id,
      projectId: 'proj-1',
      title: 'Slider jumps',
      body: 'Slider jumps\nwhen I drag it',
      authorName: 'Dot X user',
      authorUserId: null,
      authorSessionId: null,
      voteCount: 0,
      apiKeyId: 'key-1',
      sourceLabel: 'Dot X',
      metadata: {
        feedbackType: 'bug_report',
        client: { appVersion: '2.0.0-1', os: 'windows', osVersion: '10.0.26200' },
      },
    })
    expect(notifyProjectTeam).toHaveBeenCalledWith(
      'proj-1',
      null,
      expect.objectContaining({ type: 'new_feedback', body: 'Added from Dot X', feedbackId: result.data.id })
    )
  })

  it('applies a per-key rate limit', async () => {
    await handler(makeEvent('Bearer vfy_pub_abc'))
    expect(requireRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        maxRequests: 200,
        windowSeconds: 3600,
        identifier: 'app-feedback-key',
        subject: 'key-1',
      })
    )
    expect(requireRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ identifier: 'app-feedback-ip' })
    )
  })
})

describe('api-v1 CORS middleware', () => {
  beforeEach(() => {
    state.status = undefined
    state.headers = {}
  })

  it('answers preflight with 204 without auth', () => {
    const result = cors(makeEvent(undefined, { method: 'OPTIONS' }))
    expect(result).toBe('')
    expect(state.status).toBe(204)
    expect(state.headers['Access-Control-Allow-Origin']).toBe('*')
    expect(state.headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS')
    expect(state.headers['Access-Control-Allow-Headers']).toBe('Authorization, Content-Type')
    expect(state.headers['Access-Control-Max-Age']).toBe('86400')
    expect(state.headers['Access-Control-Allow-Credentials']).toBeUndefined()
  })

  it('sets CORS headers on 401 responses', async () => {
    const event = makeEvent()
    expect(cors(event)).toBeUndefined()
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 401 })
    expect(state.headers['Access-Control-Allow-Origin']).toBe('*')
  })

  it('ignores non-/api/v1 paths', () => {
    cors(makeEvent(undefined, { path: '/api/feedback' }))
    expect(state.headers).toEqual({})
    expect(state.status).toBeUndefined()
  })
})
