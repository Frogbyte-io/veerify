import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  principal: null as unknown,
  principalError: null as null | { statusCode: number },
  cookieSession: null as unknown,
  cookieError: false,
  body: {} as unknown,
  existing: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
}))

const getSession = vi.hoisted(() => vi.fn(async () => {
  if (state.cookieError) throw new Error('cookie boom')
  return state.cookieSession
}))
const resolveUserApiKeyPrincipal = vi.hoisted(() =>
  vi.fn(async () => {
    if (state.principalError) throw Object.assign(new Error('x'), state.principalError)
    return state.principal
  })
)

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)
vi.stubGlobal('readBody', async () => state.body)

vi.mock('~/lib/auth', () => ({ auth: { api: { getSession } } }))
vi.mock('~/server/utils/auth-headers', () => ({ getAuthHeaders: () => new Headers() }))
vi.mock('~/server/utils/user-api-keys', () => ({ resolveUserApiKeyPrincipal }))
vi.mock('~/server/utils/logger', () => ({ createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }))
vi.mock('~/server/database/schema/auth', () => ({ member: {}, user: { email: 'email', id: 'id' } }))
vi.mock('~/server/database/drizzle', () => ({
  db: {
    select: () => {
      const chain = { from: () => chain, where: () => chain, limit: async () => state.existing }
      return chain
    },
    update: () => {
      const chain = {
        set: (values: Record<string, unknown>) => {
          state.updated.push(values)
          return chain
        },
        where: () => chain,
        returning: async () => [{ id: 'u1', ...state.updated[state.updated.length - 1] }],
      }
      return chain
    },
  },
}))

import {
  isCredentialPrincipal,
  optionalAuth,
  requireAuth,
  requireInteractiveSession,
} from '~/server/utils/auth-middleware'

const keyPrincipal = {
  user: { id: 'u1', email: 'a@example.com', name: 'A' },
  session: { id: 'apikey:k1', userId: 'u1' },
  credential: { kind: 'user_api_key', id: 'k1' },
}
const cookieSession = { user: { id: 'u1', email: 'a@example.com', name: 'A' }, session: { id: 's1', userId: 'u1' } }

async function statusOf(promise: Promise<unknown>) {
  try {
    await promise
    return null
  } catch (error) {
    return (error as { statusCode?: number }).statusCode ?? 'other'
  }
}

beforeEach(() => {
  state.principal = null
  state.principalError = null
  state.cookieSession = null
  state.cookieError = false
  state.body = {}
  state.existing = []
  state.updated = []
  getSession.mockClear()
  resolveUserApiKeyPrincipal.mockClear()
})

describe('requireAuth with personal keys', () => {
  it('returns the key principal and never consults the cookie', async () => {
    state.principal = keyPrincipal
    state.cookieSession = cookieSession
    const result = await requireAuth({} as never)
    expect(result.credential).toEqual({ kind: 'user_api_key', id: 'k1' })
    expect(getSession).not.toHaveBeenCalled()
  })

  it('rejects an invalid key with 401 even when the cookie is valid', async () => {
    state.principalError = { statusCode: 401 }
    state.cookieSession = cookieSession
    expect(await statusOf(requireAuth({} as never))).toBe(401)
    expect(getSession).not.toHaveBeenCalled()
  })

  it('falls back to the cookie when there is no key', async () => {
    state.cookieSession = cookieSession
    const result = await requireAuth({} as never)
    expect(result.credential).toBeUndefined()
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it('throws 401 with neither key nor cookie', async () => {
    expect(await statusOf(requireAuth({} as never))).toBe(401)
  })
})

describe('optionalAuth with personal keys', () => {
  it('propagates 401 for an invalid key', async () => {
    state.principalError = { statusCode: 401 }
    state.cookieSession = cookieSession
    expect(await statusOf(optionalAuth({} as never))).toBe(401)
  })

  it('propagates 403 for bad context headers', async () => {
    state.principalError = { statusCode: 403 }
    expect(await statusOf(optionalAuth({} as never))).toBe(403)
  })

  it('returns the key principal', async () => {
    state.principal = keyPrincipal
    expect(((await optionalAuth({} as never)) as { credential: unknown }).credential).toBeTruthy()
  })

  it('follows the cookie path when no personal key resolves (e.g. vfy_pub_)', async () => {
    state.cookieSession = cookieSession
    expect(await optionalAuth({} as never)).toBe(cookieSession)
  })

  it('still swallows cookie lookup errors', async () => {
    state.cookieError = true
    expect(await optionalAuth({} as never)).toBeNull()
  })
})

describe('requireInteractiveSession', () => {
  it('rejects credential principals with 403', async () => {
    state.principal = keyPrincipal
    const error = (await requireInteractiveSession({} as never).catch((e) => e)) as {
      statusCode: number
      data: { error: { code: string; message: string } }
    }
    expect(error.statusCode).toBe(403)
    expect(error.data.error.code).toBe('FORBIDDEN')
    expect(error.data.error.message).toBe('This action requires signing in to Veerify directly')
  })

  it('returns a cookie session', async () => {
    state.cookieSession = cookieSession
    expect(await requireInteractiveSession({} as never)).toBe(cookieSession)
  })

  it('isCredentialPrincipal reflects credential presence', () => {
    expect(isCredentialPrincipal(keyPrincipal as never)).toBe(true)
    expect(isCredentialPrincipal(cookieSession as never)).toBe(false)
  })
})

describe('PUT /api/user/profile', () => {
  it('rejects a key principal changing email with 403', async () => {
    const handler = (await import('~/server/api/user/profile.put')).default as (e: unknown) => Promise<unknown>
    state.principal = keyPrincipal
    state.body = { name: 'A', email: 'other@example.com' }
    expect(await statusOf(handler({}))).toBe(403)
    expect(state.updated).toHaveLength(0)
  })

  it('allows a key principal changing only the name (email compared case-insensitively)', async () => {
    const handler = (await import('~/server/api/user/profile.put')).default as (e: unknown) => Promise<unknown>
    state.principal = keyPrincipal
    state.body = { name: 'New Name', email: 'A@Example.com' }
    state.existing = [{ id: 'u1' }]
    const result = (await handler({})) as { success: boolean }
    expect(result.success).toBe(true)
    expect(state.updated[0].name).toBe('New Name')
  })
})
