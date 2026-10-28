import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiCaller, isBlockedApiPath, normalizeApiPath } from '~/server/mcp/api-bridge'

function refused(path: string): boolean {
  const normalized = normalizeApiPath(path)
  return normalized === null || isBlockedApiPath(normalized)
}

describe('normalizeApiPath + isBlockedApiPath (Review Focus 4)', () => {
  it.each([
    '/api/../api/auth/x',
    '/api/%2e%2e/auth/x',
    '/api/%2E%2E/api/auth/x',
    '/API/Auth/x',
    '/api//auth/x',
    '/api/./auth/x',
    '/api/auth',
    '/api/auth/',
    '/api/cron/sla',
    '/api/public/auth/session',
    '/api/user/api-keys',
    '/api/user/api-keys/1',
    '/api/User/API-Keys',
    '/api/test',
    '/api/device',
    '/api/device/code',
    '/api/device/requests/ABCD-EFGH/approve',
    '/api/Device/Token',
    '/api/%61uth/x',
    '/api/%252e%252e/auth/x',
    '/api/x/..%2f..%2fapi/auth/x',
    '/api\\auth\\x',
    'https://evil/x',
    '//evil/x',
    '/mcp',
    '/api',
    '/api/..',
    '/api/../../etc',
    '/',
    '',
    'relative/path',
    '/api/%zz',
    '/api/\uD800',
    '/api/%ED%A0%80',
    '/api/auth;x=1',
    '/api/auth;/x',
    '/api/projects/..;/auth/x',
    '/api/．．/auth/x',
    '/api/%EF%BC%8E%EF%BC%8E/auth/x',
    '/api/auth#fragment',
    '/api/%23/../auth/x',
  ])('refuses %s', (path) => {
    expect(refused(path)).toBe(true)
  })

  it.each([
    '/api/projects',
    '/api/projects/acme/statuses',
    '/api/user/profile',
    '/api/feedback?x=1',
    '/api/testimonials',
  ])('allows %s', (path) => {
    expect(refused(path)).toBe(false)
  })

  it('returns the resolved path and keeps the query string', () => {
    expect(normalizeApiPath('/api/projects//acme/./statuses/')).toBe('/api/projects/acme/statuses')
    expect(normalizeApiPath('/api/feedback?x=1')).toBe('/api/feedback?x=1')
    expect(normalizeApiPath('/api/x/../projects')).toBe('/api/projects')
  })
})

describe('createApiCaller', () => {
  const raw = vi.fn()

  beforeEach(() => {
    raw.mockReset()
    vi.stubGlobal('$fetch', Object.assign(vi.fn(), { raw }))
  })

  it('forwards only authorization, x-veerify-* and the caller ip as x-forwarded-for', async () => {
    raw.mockResolvedValue({ status: 200, _data: { success: true, data: [] } })
    const callApi = createApiCaller(
      'Bearer vfy_usr_abc',
      {
        'x-veerify-organization': 'acme',
        'X-Veerify-Project': 'web',
        cookie: 'better-auth.session_token=steal',
        'x-forwarded-for': '1.2.3.4',
        authorization: 'Bearer other',
      },
      { clientIp: '203.0.113.7' }
    )

    const result = await callApi({ method: 'GET', path: '/api/projects', query: { a: 1 } })

    expect(result).toEqual({ status: 200, body: { success: true, data: [] } })
    expect(raw).toHaveBeenCalledTimes(1)
    const [path, options] = raw.mock.calls[0]!
    expect(path).toBe('/api/projects')
    expect(options).toMatchObject({ method: 'GET', query: { a: 1 }, ignoreResponseError: true })
    expect(options.headers).toEqual({
      authorization: 'Bearer vfy_usr_abc',
      'x-veerify-organization': 'acme',
      'x-veerify-project': 'web',
      'x-forwarded-for': '203.0.113.7',
    })
  })

  it('forwards the given client ip as x-forwarded-for and a per-call header cannot override it', async () => {
    raw.mockResolvedValue({ status: 200, _data: null })
    const callApi = createApiCaller('Bearer vfy_usr_abc', {}, { clientIp: '198.51.100.1' })

    await callApi({ method: 'GET', path: '/api/projects', headers: { 'x-forwarded-for': '6.6.6.6' } })

    expect(raw.mock.calls[0]![1].headers['x-forwarded-for']).toBe('198.51.100.1')
  })

  it('sends different x-forwarded-for values for callers with different ips', async () => {
    raw.mockResolvedValue({ status: 200, _data: null })
    const a = createApiCaller('Bearer vfy_usr_a', {}, { clientIp: '198.51.100.1' })
    const b = createApiCaller('Bearer vfy_usr_b', {}, { clientIp: '198.51.100.2' })

    await a({ method: 'GET', path: '/api/projects' })
    await b({ method: 'GET', path: '/api/projects' })

    expect(raw.mock.calls[0]![1].headers['x-forwarded-for']).toBe('198.51.100.1')
    expect(raw.mock.calls[1]![1].headers['x-forwarded-for']).toBe('198.51.100.2')
  })

  it('omits x-forwarded-for when no client ip is known', async () => {
    raw.mockResolvedValue({ status: 200, _data: null })
    const callApi = createApiCaller('Bearer vfy_usr_abc', {})

    await callApi({ method: 'GET', path: '/api/projects' })

    expect(raw.mock.calls[0]![1].headers).toEqual({ authorization: 'Bearer vfy_usr_abc' })
  })

  it('returns { status, body } for a 404 without throwing', async () => {
    raw.mockResolvedValue({ status: 404, _data: { success: false, error: { code: 'NOT_FOUND', message: 'nope' } } })
    const callApi = createApiCaller('Bearer vfy_usr_abc', {})

    await expect(callApi({ method: 'DELETE', path: '/api/projects/x' })).resolves.toEqual({
      status: 404,
      body: { success: false, error: { code: 'NOT_FOUND', message: 'nope' } },
    })
  })

  it('never sends a blocked path even when called directly', async () => {
    const callApi = createApiCaller('Bearer vfy_usr_abc', {})
    const result = await callApi({ method: 'POST', path: '/api/../api/auth/sign-out' })
    expect(result.status).toBe(403)
    expect(raw).not.toHaveBeenCalled()
  })
})
