import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GoogleApiError,
  GoogleAuthError,
  buildAuthorizationUrl,
  exchangeCode,
  getGoogleOAuthConfig,
  listSites,
  matchPropertyForOrigin,
  isPropertySelectableForOrigin,
  querySearchAnalytics,
  refreshAccessToken,
  revokeToken,
} from '../server/services/google/search-console'
import { OAuthStateError, signOAuthState, verifyOAuthState } from '../server/services/google/oauth-state'

const config = {
  clientId: 'cid',
  clientSecret: 'super-secret-client',
  redirectUri: 'https://app.test/api/marketing/google/callback',
}
const fetchMock = vi.fn()
const reply = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }))

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-one')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const payload = { siteId: 's1', userId: 'u1', projectId: 'p1' }

describe('oauth state', () => {
  it('round-trips', () => {
    const state = signOAuthState(payload)
    expect(state.split('.')).toHaveLength(2)
    expect(verifyOAuthState(state)).toEqual({ ...payload, nonce: expect.any(String) })
  })
  it('uses a fresh nonce each time', () => {
    expect(signOAuthState(payload)).not.toBe(signOAuthState(payload))
  })
  it('rejects tampered payload', () => {
    const [, sig] = signOAuthState(payload).split('.')
    const forged = Buffer.from(JSON.stringify({ ...payload, userId: 'evil', exp: Date.now() + 1e6 })).toString(
      'base64url'
    )
    expect(() => verifyOAuthState(`${forged}.${sig}`)).toThrow(expect.objectContaining({ kind: 'bad_signature' }))
  })
  it('rejects expired', () => {
    vi.useFakeTimers()
    const state = signOAuthState(payload, 1000)
    vi.advanceTimersByTime(1001)
    expect(() => verifyOAuthState(state)).toThrow(expect.objectContaining({ kind: 'expired' }))
  })
  it('rejects wrong secret', () => {
    const state = signOAuthState(payload)
    vi.stubEnv('BETTER_AUTH_SECRET', 'another-secret')
    expect(() => verifyOAuthState(state)).toThrow(expect.objectContaining({ kind: 'bad_signature' }))
  })
  it('rejects malformed input', () => {
    for (const s of ['', 'abc', 'a.b.c', '.x', 'x.']) {
      expect(() => verifyOAuthState(s)).toThrow(OAuthStateError)
    }
  })
})

describe('config and authorization url', () => {
  it('returns null when not configured, reads env lazily', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '')
    expect(getGoogleOAuthConfig()).toBeNull()
    vi.stubEnv('GOOGLE_CLIENT_ID', 'a')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'b')
    vi.stubEnv('BETTER_AUTH_URL', 'https://app.test/')
    expect(getGoogleOAuthConfig()).toEqual({
      clientId: 'a',
      clientSecret: 'b',
      redirectUri: 'https://app.test/api/marketing/google/callback',
    })
  })
  it('builds the auth url', () => {
    const url = new URL(buildAuthorizationUrl(config, 'st'))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const p = url.searchParams
    expect(p.get('scope')).toBe('https://www.googleapis.com/auth/webmasters.readonly openid email')
    expect(p.get('access_type')).toBe('offline')
    expect(p.get('prompt')).toBe('consent')
    expect(p.get('include_granted_scopes')).toBe('true')
    expect(p.get('response_type')).toBe('code')
    expect(p.get('state')).toBe('st')
    expect(p.get('redirect_uri')).toBe(config.redirectUri)
    expect(p.get('client_secret')).toBeNull()
  })
})

describe('tokens', () => {
  it('exchanges a code and looks up email via userinfo', async () => {
    reply(200, {
      access_token: 'at-1',
      refresh_token: 'rt-1',
      expires_in: 3600,
      scope: 'openid email https://www.googleapis.com/auth/webmasters.readonly',
    })
    reply(200, { email: 'me@acme.com' })
    const r = await exchangeCode(config, 'code-1')
    expect(r).toMatchObject({ refreshToken: 'rt-1', accessToken: 'at-1', email: 'me@acme.com' })
    expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    const body = new URLSearchParams(init.body)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('code-1')
    expect(fetchMock.mock.calls[1][0]).toBe('https://openidconnect.googleapis.com/v1/userinfo')
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer at-1')
  })
  it('tolerates userinfo failure', async () => {
    reply(200, { access_token: 'a', refresh_token: 'r', expires_in: 10 })
    reply(500, {})
    expect((await exchangeCode(config, 'c')).email).toBeNull()
  })
  it('requires a refresh token and the search console scope', async () => {
    reply(200, { access_token: 'a', expires_in: 10 })
    await expect(exchangeCode(config, 'c')).rejects.toBeInstanceOf(GoogleApiError)
    reply(200, { access_token: 'a', refresh_token: 'r', scope: 'openid email' })
    await expect(exchangeCode(config, 'c')).rejects.toMatchObject({ kind: 'forbidden' })
  })
  it('refreshes', async () => {
    reply(200, { access_token: 'at-2', expires_in: 3599 })
    const r = await refreshAccessToken(config, 'rt-1')
    expect(r.accessToken).toBe('at-2')
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get('grant_type')).toBe('refresh_token')
  })
  it('maps invalid_grant to revoked GoogleAuthError', async () => {
    reply(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
    const err = await refreshAccessToken(config, 'rt-secret').catch((e) => e)
    expect(err).toBeInstanceOf(GoogleAuthError)
    expect(err.kind).toBe('revoked')
  })
  it('revokeToken is best-effort', async () => {
    reply(200, {})
    expect(await revokeToken('t')).toBe(true)
    fetchMock.mockRejectedValueOnce(new Error('boom'))
    expect(await revokeToken('t')).toBe(false)
  })
})

describe('search console api', () => {
  it('lists sites', async () => {
    reply(200, { siteEntry: [{ siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteOwner' }] })
    expect(await listSites('at')).toEqual([{ siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteOwner' }])
    expect(fetchMock.mock.calls[0][0]).toBe('https://www.googleapis.com/webmasters/v3/sites')
  })
  it('returns empty list when no siteEntry', async () => {
    reply(200, {})
    expect(await listSites('at')).toEqual([])
  })
  it('encodes sc-domain and url-prefix properties', async () => {
    reply(200, { rows: [{ keys: ['2026-01-01'], clicks: 3, impressions: 10, ctr: 0.3, position: 4.2 }] })
    const rows = await querySearchAnalytics('at', 'sc-domain:acme.com', {
      startDate: '2026-01-01',
      endDate: '2026-01-28',
      dimensions: ['date'],
      rowLimit: 100,
      dataState: 'all',
    })
    expect(rows).toEqual([{ keys: ['2026-01-01'], clicks: 3, impressions: 10, ctr: 0.3, position: 4.2 }])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aacme.com/searchAnalytics/query')
    expect(JSON.parse(init.body)).toMatchObject({ dimensions: ['date'], rowLimit: 100, dataState: 'all' })
    reply(200, {})
    await querySearchAnalytics('at', 'https://acme.com/', {
      startDate: 'a',
      endDate: 'b',
      dimensions: [],
      rowLimit: 1,
    })
    expect(fetchMock.mock.calls[1][0]).toContain('/sites/https%3A%2F%2Facme.com%2F/searchAnalytics/query')
  })
})

describe('isPropertySelectableForOrigin', () => {
  it('accepts the origin prefix property and its domain property', () => {
    expect(isPropertySelectableForOrigin('https://acme.com', 'https://acme.com/')).toBe(true)
    expect(isPropertySelectableForOrigin('https://acme.com', 'https://acme.com')).toBe(true)
    expect(isPropertySelectableForOrigin('https://app.acme.com', 'sc-domain:acme.com')).toBe(true)
    expect(isPropertySelectableForOrigin('https://www.acme.com', 'https://www.acme.com/')).toBe(true)
  })
  it('rejects other sites, variants, paths and schemes', () => {
    expect(isPropertySelectableForOrigin('https://acme.com', 'https://www.acme.com/')).toBe(false)
    expect(isPropertySelectableForOrigin('https://acme.com', 'https://other.com/')).toBe(false)
    expect(isPropertySelectableForOrigin('https://acme.com', 'https://acme.com/blog/')).toBe(false)
    expect(isPropertySelectableForOrigin('https://acme.com', 'http://acme.com/')).toBe(false)
    expect(isPropertySelectableForOrigin('https://acme.com', 'sc-domain:other.com')).toBe(false)
  })
  it('matchPropertyForOrigin never returns a non-matching property', () => {
    const sites = [{ siteUrl: 'https://acme.com/blog/', permissionLevel: 'siteOwner' }]
    expect(matchPropertyForOrigin('https://acme.com', sites)).toBeNull()
  })
})

describe('matchPropertyForOrigin', () => {
  const sites = [
    { siteUrl: 'sc-domain:acme.com', permissionLevel: 'siteFullUser' },
    { siteUrl: 'https://acme.com/', permissionLevel: 'siteOwner' },
    { siteUrl: 'https://other.com/', permissionLevel: 'siteUnverifiedUser' },
    { siteUrl: 'sc-domain:other.com', permissionLevel: 'siteUnverifiedUser' },
  ]
  it('prefers exact url-prefix', () => {
    expect(matchPropertyForOrigin('https://acme.com', sites)?.siteUrl).toBe('https://acme.com/')
  })
  it('falls back to domain property, including subdomains', () => {
    expect(matchPropertyForOrigin('https://acme.com', [sites[0]])?.siteUrl).toBe('sc-domain:acme.com')
    expect(matchPropertyForOrigin('https://app.acme.com', sites)?.siteUrl).toBe('sc-domain:acme.com')
  })
  it('ignores unverified and unrelated', () => {
    expect(matchPropertyForOrigin('https://other.com', sites)).toBeNull()
    expect(matchPropertyForOrigin('https://nope.io', sites)).toBeNull()
    expect(matchPropertyForOrigin('not a url', sites)).toBeNull()
  })
})

describe('error mapping', () => {
  const cases: [number, unknown, string][] = [
    [401, { error: { status: 'UNAUTHENTICATED' } }, 'auth'],
    [403, { error: { errors: [{ reason: 'forbidden' }] } }, 'forbidden'],
    [403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 'rate_limit'],
    [429, {}, 'rate_limit'],
    [400, { error: { message: 'bad' } }, 'bad_request'],
    [503, {}, 'server'],
  ]
  it.each(cases)('maps %i to %s', async (status, body, kind) => {
    reply(status, body)
    await expect(listSites('at')).rejects.toMatchObject({ kind })
  })
  it('maps invalid_client on token endpoint to auth', async () => {
    reply(401, { error: 'invalid_client' })
    await expect(refreshAccessToken(config, 'r')).rejects.toMatchObject({ kind: 'auth' })
  })
  it('maps network and timeout failures', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed token=abc'))
    await expect(listSites('at')).rejects.toMatchObject({ kind: 'network' })
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('t'), { name: 'TimeoutError' }))
    await expect(listSites('at')).rejects.toMatchObject({ kind: 'timeout' })
  })
  it('never leaks tokens or secrets in messages', async () => {
    reply(400, { error: 'invalid_request', error_description: 'bad rt-secret-token super-secret-client' })
    const err = await refreshAccessToken(config, 'rt-secret-token').catch((e) => e)
    fetchMock.mockRejectedValueOnce(new Error('failed for rt-secret-token'))
    const err2 = await refreshAccessToken(config, 'rt-secret-token').catch((e) => e)
    reply(500, { error: { message: 'at-leak' } })
    const err3 = await listSites('at-leak').catch((e) => e)
    for (const e of [err, err2, err3]) {
      expect(e).toBeInstanceOf(GoogleApiError)
      expect(`${e.message} ${e.stack}`).not.toMatch(/rt-secret-token|super-secret-client|at-leak/)
    }
  })
})

describe('oauth state signature encoding', () => {
  it('rejects a non-canonical spelling of a valid signature', async () => {
    const { signOAuthState, verifyOAuthState } = await import('~/server/services/google/oauth-state')
    process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'test-secret-for-oauth-state-0123456789'
    const state = signOAuthState({ siteId: 's', userId: 'u', projectId: 'p' })
    const [data, sig] = state.split('.')
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const last = alphabet.indexOf(sig[sig.length - 1])
    // Same 4 significant bits, different padding bits: decodes to the same bytes.
    const twin = alphabet[(last & 0b111100) | ((last + 1) & 0b11)]
    expect(() => verifyOAuthState(`${data}.${sig.slice(0, -1)}${twin}`)).toThrow()
    expect(verifyOAuthState(state)).toMatchObject({ siteId: 's' })
  })
})
