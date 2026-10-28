import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent, readBody as h3ReadBody } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  body: undefined as unknown,
  principal: false,
  params: {} as Record<string, string>,
  status: undefined as number | undefined,
  headers: {} as Record<string, string>,
  requestHeaders: {} as Record<string, string>,
}))

const requireInteractiveSession = vi.hoisted(() =>
  vi.fn(async (_event: unknown) => {
    if (state.principal) throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
    return { user: { id: 'user-1' } }
  })
)
const checkRateLimit = vi.hoisted(() => vi.fn(async (_e: unknown, _c: unknown) => true))
const requireRateLimit = vi.hoisted(() => vi.fn(async (_e: unknown, _c: unknown) => undefined))
const service = vi.hoisted(() => ({
  createDeviceAuthorization: vi.fn(),
  findPendingByUserCode: vi.fn(),
  approveDeviceAuthorization: vi.fn(),
  denyDeviceAuthorization: vi.fn(),
  pollDeviceToken: vi.fn(),
}))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('createError', (input: { statusCode: number; statusMessage: string; data?: unknown }) =>
  Object.assign(new Error(input.statusMessage), input)
)
vi.stubGlobal('readBody', async () => state.body)
vi.stubGlobal('getRouterParam', (_e: unknown, name: string) => state.params[name])
vi.stubGlobal('setResponseStatus', (_e: unknown, code: number) => {
  state.status = code
})
vi.stubGlobal('setResponseHeader', (_e: unknown, name: string, value: string) => {
  state.headers[name] = value
})
vi.stubGlobal('getRequestURL', () => new URL('http://req.example/api/device/code'))
vi.stubGlobal(
  'getHeader',
  (e: { node?: { req: { headers: Record<string, string> } } }, name: string) =>
    state.requestHeaders[name] ?? e?.node?.req?.headers?.[name]
)

vi.mock('~/server/utils/auth-middleware', () => ({ requireInteractiveSession }))
vi.mock('~/server/utils/rate-limit', () => ({ requireRateLimit, checkRateLimit }))
vi.mock('~/server/utils/response', () => ({
  createSuccessResponse: (data: unknown) => ({ success: true, data }),
  createErrorResponse: (code: string, message: string, details?: unknown) => ({
    success: false,
    error: { code, message, details },
  }),
  ErrorCode: { VALIDATION_ERROR: 'VALIDATION_ERROR', NOT_FOUND: 'NOT_FOUND', CONFLICT: 'CONFLICT' },
}))
vi.mock('~/server/services/device-login', () => ({
  ...service,
  notFound: () => {
    throw Object.assign(new Error('Not Found'), {
      statusCode: 404,
      statusMessage: 'Not Found',
      data: { success: false, error: { code: 'NOT_FOUND', message: 'Code not found or expired' } },
    })
  },
  formatUserCode: (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`,
  normalizeUserCode: (c: string) => c.toUpperCase().replace(/[^BCDFGHJKLMNPQRSTVWXZ]/g, ''),
}))

const codeHandler = (await import('~/server/api/device/code.post')).default as (e: unknown) => Promise<any>
const tokenHandler = (await import('~/server/api/device/token.post')).default as (e: unknown) => Promise<any>
const lookupHandler = (await import('~/server/api/device/requests/[userCode].get')).default as (
  e: unknown
) => Promise<any>
const approveHandler = (await import('~/server/api/device/requests/[userCode]/approve.post')).default as (
  e: unknown
) => Promise<any>
const denyHandler = (await import('~/server/api/device/requests/[userCode]/deny.post')).default as (
  e: unknown
) => Promise<any>

const GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const notFoundError = () =>
  Object.assign(new Error('Not Found'), {
    statusCode: 404,
    statusMessage: 'Not Found',
    data: { success: false, error: { code: 'NOT_FOUND', message: 'Code not found or expired' } },
  })

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(state, {
    body: undefined,
    principal: false,
    params: {},
    status: undefined,
    headers: {},
    requestHeaders: {},
  })
  process.env.BETTER_AUTH_URL = 'https://app.example.com'
})

describe('POST /api/device/code', () => {
  it('returns the RFC 8628 shape with no-store and rate limits per IP', async () => {
    service.createDeviceAuthorization.mockResolvedValue({
      deviceCode: 'vfy_dev_x',
      userCode: 'BCDF-GHJK',
      expiresIn: 600,
      interval: 5,
    })
    state.body = { client_name: '  Claude Code ' }
    const res = await codeHandler({})
    expect(res).toEqual({
      device_code: 'vfy_dev_x',
      user_code: 'BCDF-GHJK',
      verification_uri: 'https://app.example.com/device',
      verification_uri_complete: 'https://app.example.com/device?code=BCDF-GHJK',
      expires_in: 600,
      interval: 5,
    })
    expect(service.createDeviceAuthorization).toHaveBeenCalledWith({ clientName: 'Claude Code' })
    expect(state.headers['Cache-Control']).toBe('no-store')
    expect(requireRateLimit).toHaveBeenCalledWith(expect.anything(), {
      maxRequests: 10,
      windowSeconds: 60,
      identifier: 'device-code',
    })
  })

  it('accepts an empty body', async () => {
    service.createDeviceAuthorization.mockResolvedValue({
      deviceCode: 'd',
      userCode: 'BCDF-GHJK',
      expiresIn: 600,
      interval: 5,
    })
    await codeHandler({})
    expect(service.createDeviceAuthorization).toHaveBeenCalledWith({ clientName: undefined })
  })

  it('falls back to localhost, not the request origin, when BETTER_AUTH_URL is unset', async () => {
    delete process.env.BETTER_AUTH_URL
    service.createDeviceAuthorization.mockResolvedValue({
      deviceCode: 'd',
      userCode: 'BCDF-GHJK',
      expiresIn: 600,
      interval: 5,
    })
    expect((await codeHandler({})).verification_uri).toBe('http://localhost:3000/device')
  })

  it('rejects an over-long client_name as invalid_request', async () => {
    state.body = { client_name: 'x'.repeat(61) }
    expect(await codeHandler({})).toMatchObject({ error: 'invalid_request' })
    expect(state.status).toBe(400)
    expect(service.createDeviceAuthorization).not.toHaveBeenCalled()
  })
})

describe('POST /api/device/token', () => {
  it.each(['authorization_pending', 'slow_down', 'access_denied', 'expired_token', 'invalid_grant'])(
    'maps %s to a 400 RFC error',
    async (error) => {
      service.pollDeviceToken.mockResolvedValue({ ok: false, error, description: 'desc' })
      state.body = { device_code: 'vfy_dev_x', grant_type: GRANT }
      const res = await tokenHandler({})
      expect(state.status).toBe(400)
      expect(res).toEqual({ error, error_description: 'desc' })
      expect(state.headers['Cache-Control']).toBe('no-store')
    }
  )

  it('returns the token with no-store on success and rate limits per IP', async () => {
    service.pollDeviceToken.mockResolvedValue({ ok: true, accessToken: 'vfy_usr_abc', expiresIn: 7776000 })
    state.body = { device_code: 'vfy_dev_x' }
    const res = await tokenHandler({})
    expect(res).toEqual({ access_token: 'vfy_usr_abc', token_type: 'Bearer', expires_in: 7776000 })
    expect(state.status).toBe(200)
    expect(state.headers['Cache-Control']).toBe('no-store')
    expect(state.headers.Pragma).toBe('no-cache')
    expect(checkRateLimit).toHaveBeenCalledWith(expect.anything(), {
      maxRequests: 600,
      windowSeconds: 60,
      identifier: 'device-token',
    })
  })

  it('returns 400 slow_down with no-store when the IP limit rejects, without polling', async () => {
    checkRateLimit.mockResolvedValueOnce(false)
    state.body = { device_code: 'vfy_dev_x' }
    const res = await tokenHandler({})
    expect(state.status).toBe(400)
    expect(res).toEqual({ error: 'slow_down', error_description: 'Too many requests; slow down' })
    expect(state.headers['Cache-Control']).toBe('no-store')
    expect(state.headers.Pragma).toBe('no-cache')
    expect(service.pollDeviceToken).not.toHaveBeenCalled()
  })

  it('rejects an oversized body as invalid_request before reading it (token and code)', async () => {
    state.requestHeaders['content-length'] = String(8 * 1024 + 1)
    state.body = { device_code: 'x' }
    expect(await tokenHandler({})).toMatchObject({ error: 'invalid_request' })
    expect(state.status).toBe(400)
    state.status = undefined
    expect(await codeHandler({})).toMatchObject({ error: 'invalid_request' })
    expect(state.status).toBe(400)
    expect(service.pollDeviceToken).not.toHaveBeenCalled()
    expect(service.createDeviceAuthorization).not.toHaveBeenCalled()
  })

  it('reads a real form-urlencoded body through the token handler', async () => {
    vi.stubGlobal('readBody', h3ReadBody)
    try {
      const req = new IncomingMessage(new Socket())
      req.method = 'POST'
      const raw = `grant_type=${encodeURIComponent(GRANT)}&device_code=vfy_dev_form`
      req.headers['content-type'] = 'application/x-www-form-urlencoded'
      req.headers['content-length'] = String(Buffer.byteLength(raw))
      req.push(raw)
      req.push(null)
      service.pollDeviceToken.mockResolvedValue({ ok: true, accessToken: 'vfy_usr_f', expiresIn: 1 })
      const res = await tokenHandler(createEvent(req, new ServerResponse(req)))
      expect(service.pollDeviceToken).toHaveBeenCalledWith('vfy_dev_form')
      expect(res).toMatchObject({ access_token: 'vfy_usr_f' })
    } finally {
      vi.stubGlobal('readBody', async () => state.body)
    }
  })

  it('rejects a wrong grant_type and a missing device_code as invalid_request', async () => {
    state.body = { device_code: 'x', grant_type: 'password' }
    expect(await tokenHandler({})).toMatchObject({ error: 'invalid_request' })
    expect(state.status).toBe(400)
    state.body = {}
    expect(await tokenHandler({})).toMatchObject({ error: 'invalid_request' })
    state.body = undefined
    expect(await tokenHandler({})).toMatchObject({ error: 'invalid_request' })
    expect(service.pollDeviceToken).not.toHaveBeenCalled()
  })

  it('h3 readBody parses a form-urlencoded body (what the handler relies on)', async () => {
    const req = new IncomingMessage(new Socket())
    req.method = 'POST'
    req.headers['content-type'] = 'application/x-www-form-urlencoded'
    const raw = `grant_type=${encodeURIComponent(GRANT)}&device_code=vfy_dev_abc`
    req.headers['content-length'] = String(Buffer.byteLength(raw))
    req.push(raw)
    req.push(null)
    const event = createEvent(req, new ServerResponse(req))
    expect(await h3ReadBody(event)).toEqual({ grant_type: GRANT, device_code: 'vfy_dev_abc' })
  })
})

describe.each([
  ['lookup', () => lookupHandler],
  ['approve', () => approveHandler],
  ['deny', () => denyHandler],
])('user-facing %s', (_name, handler) => {
  it('refuses a key principal with 403 and does not consume the rate limit', async () => {
    state.principal = true
    state.params = { userCode: 'BCDF-GHJK' }
    await expect(handler()({})).rejects.toMatchObject({ statusCode: 403 })
    expect(requireRateLimit).not.toHaveBeenCalled()
    expect(service.approveDeviceAuthorization).not.toHaveBeenCalled()
    expect(service.denyDeviceAuthorization).not.toHaveBeenCalled()
    expect(service.findPendingByUserCode).not.toHaveBeenCalled()
  })

  it('applies the per-user rate limit', async () => {
    state.params = { userCode: 'BCDF-GHJK' }
    service.findPendingByUserCode.mockResolvedValue({ id: 'i', clientName: null, expiresAt: new Date() })
    await handler()({})
    expect(requireRateLimit).toHaveBeenCalledWith(expect.anything(), {
      maxRequests: 10,
      windowSeconds: 60,
      identifier: 'device-approve',
      subject: 'user-1',
    })
  })

  it('propagates a 429 from the rate limit before touching the service', async () => {
    state.params = { userCode: 'BCDF-GHJK' }
    requireRateLimit.mockRejectedValueOnce(Object.assign(new Error('Too Many'), { statusCode: 429 }))
    await expect(handler()({})).rejects.toMatchObject({ statusCode: 429 })
    expect(service.findPendingByUserCode).not.toHaveBeenCalled()
    expect(service.approveDeviceAuthorization).not.toHaveBeenCalled()
    expect(service.denyDeviceAuthorization).not.toHaveBeenCalled()
  })
})

describe('lookup', () => {
  it('returns the formatted code, client name and expiry', async () => {
    const expiresAt = new Date('2026-10-28T12:00:00Z')
    state.params = { userCode: 'bcdfghjk' }
    service.findPendingByUserCode.mockResolvedValue({ id: 'i', clientName: 'Claude', expiresAt })
    expect(await lookupHandler({})).toEqual({ data: { userCode: 'BCDF-GHJK', clientName: 'Claude', expiresAt } })
  })

  it('gives identical 404 bodies for unknown and expired codes', async () => {
    state.params = { userCode: 'BCDF-GHJK' }
    service.findPendingByUserCode.mockResolvedValue(null)
    const a = await lookupHandler({}).catch((e) => e)
    state.params = { userCode: 'ZZZZ-ZZZZ' }
    const b = await lookupHandler({}).catch((e) => e)
    expect(a.statusCode).toBe(404)
    expect({ s: a.statusCode, m: a.statusMessage, d: a.data }).toEqual({
      s: b.statusCode,
      m: b.statusMessage,
      d: b.data,
    })
    expect(a.data.error).toMatchObject({ code: 'NOT_FOUND', message: 'Code not found or expired' })
  })
})

describe('approve and deny', () => {
  it('approve calls the service with the session user and returns approved', async () => {
    state.params = { userCode: 'BCDF-GHJK' }
    expect(await approveHandler({})).toEqual({ data: { status: 'approved' } })
    expect(service.approveDeviceAuthorization).toHaveBeenCalledWith('BCDF-GHJK', 'user-1')
  })

  it('deny calls the service with the session user and returns denied', async () => {
    state.params = { userCode: 'BCDF-GHJK' }
    expect(await denyHandler({})).toEqual({ data: { status: 'denied' } })
    expect(service.denyDeviceAuthorization).toHaveBeenCalledWith('BCDF-GHJK', 'user-1')
  })

  it('passes the service 404 and 409 through unchanged', async () => {
    state.params = { userCode: 'BCDF-GHJK' }
    service.approveDeviceAuthorization.mockRejectedValueOnce(notFoundError())
    await expect(approveHandler({})).rejects.toMatchObject({ statusCode: 404 })
    service.approveDeviceAuthorization.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { statusCode: 409 }))
    await expect(approveHandler({})).rejects.toMatchObject({ statusCode: 409 })
  })
})
