import { getDomain } from 'tldts'

/**
 * Google OAuth + Search Console client (fetch only, no SDK).
 *
 * Docs (verified October 2026):
 * - OAuth 2.0 for web server apps: https://developers.google.com/identity/protocols/oauth2/web-server
 *   auth https://accounts.google.com/o/oauth2/v2/auth, token https://oauth2.googleapis.com/token,
 *   revoke https://oauth2.googleapis.com/revoke
 * - Search Analytics query: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 *   POST https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query (rowLimit 1-25000)
 * - Sites list: https://developers.google.com/webmaster-tools/v1/sites/list
 *   GET https://www.googleapis.com/webmasters/v3/sites
 * - Userinfo (OpenID Connect): https://developers.google.com/identity/openid-connect/openid-connect
 *   GET https://openidconnect.googleapis.com/v1/userinfo
 *
 * Scopes: webmasters.readonly (read only), openid + email (to show which account is connected).
 *
 * Email lookup: we call the userinfo endpoint with the access token instead of decoding the
 * id_token, because an unverified JWT payload must not be trusted. Failure is non-fatal (email null).
 *
 * Secrets: tokens and the client secret never appear in error messages or logs.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const WEBMASTERS_URL = 'https://www.googleapis.com/webmasters/v3'

export const GSC_SCOPES = 'https://www.googleapis.com/auth/webmasters.readonly openid email'
const GSC_READ_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
const TIMEOUT_MS = 20_000

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export type GoogleApiErrorKind =
  | 'auth'
  | 'revoked'
  | 'rate_limit'
  | 'forbidden'
  | 'bad_request'
  | 'server'
  | 'network'
  | 'timeout'

export class GoogleApiError extends Error {
  readonly kind: GoogleApiErrorKind
  readonly status?: number
  constructor(kind: GoogleApiErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'GoogleApiError'
    this.kind = kind
    this.status = status
  }
}

/** Thrown when a refresh token is no longer valid (`invalid_grant`). Always kind `revoked`. */
export class GoogleAuthError extends GoogleApiError {
  constructor(message = 'Google access was revoked or expired; reconnect required', status?: number) {
    super('revoked', message, status)
    this.name = 'GoogleAuthError'
  }
}

/** The OAuth redirect URI, built from BETTER_AUTH_URL only (known even before the client id is set). */
export function getGoogleRedirectUri(): string | null {
  const base = process.env.BETTER_AUTH_URL?.trim().replace(/\/+$/, '')
  return base ? `${base}/api/marketing/google/callback` : null
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  const redirectUri = getGoogleRedirectUri()
  if (!clientId || !clientSecret || !redirectUri) return null
  return { clientId, clientSecret, redirectUri }
}

export function buildAuthorizationUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GSC_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

// ---------------------------------------------------------------------------
// HTTP plumbing

interface RawResponse {
  status: number
  json: Record<string, any> | null
}

async function request(url: string, init: RequestInit): Promise<RawResponse> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    const name = (err as { name?: string })?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new GoogleApiError('timeout', 'Google request timed out')
    }
    // Deliberately no err.message: it can echo request details.
    throw new GoogleApiError('network', 'Could not reach Google')
  }
  let json: Record<string, any> | null = null
  try {
    json = (await res.json()) as Record<string, any>
  } catch {
    json = null
  }
  return { status: res.status, json }
}

function safeCode(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,60}$/.test(value) ? value : ''
}

/** Google error code only (never the raw body). Handles OAuth and Google API error shapes. */
function errorCode(json: Record<string, any> | null): string {
  if (!json) return ''
  if (typeof json.error === 'string') return safeCode(json.error)
  const reason = json.error?.errors?.[0]?.reason ?? json.error?.details?.[0]?.reason
  return safeCode(reason) || safeCode(json.error?.status)
}

function failure(res: RawResponse, what: string): GoogleApiError {
  const { status } = res
  const code = errorCode(res.json)
  const suffix = code ? ` (${code})` : ''
  const msg = `${what} failed: HTTP ${status}${suffix}`
  if (code === 'invalid_grant') return new GoogleAuthError(undefined, status)
  if (status === 429 || /rateLimit|quotaExceeded|RESOURCE_EXHAUSTED/i.test(code)) {
    return new GoogleApiError('rate_limit', msg, status)
  }
  if (status === 401 || code === 'invalid_client' || code === 'unauthorized_client') {
    return new GoogleApiError('auth', msg, status)
  }
  if (status === 403) return new GoogleApiError('forbidden', msg, status)
  if (status >= 500) return new GoogleApiError('server', msg, status)
  return new GoogleApiError('bad_request', msg, status)
}

function form(values: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(values).toString(),
  }
}

function bearer(accessToken: string, extra: RequestInit = {}): RequestInit {
  return {
    ...extra,
    headers: {
      Accept: 'application/json',
      ...(extra.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${accessToken}`,
    },
  }
}

// ---------------------------------------------------------------------------
// Token endpoints

export interface TokenExchangeResult {
  refreshToken: string
  accessToken: string
  expiresAt: Date
  email: string | null
}

function expiryFrom(json: Record<string, any>): Date {
  const seconds = typeof json.expires_in === 'number' ? json.expires_in : 3600
  return new Date(Date.now() + seconds * 1000)
}

export async function exchangeCode(config: GoogleOAuthConfig, code: string): Promise<TokenExchangeResult> {
  const res = await request(
    TOKEN_URL,
    form({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    })
  )
  if (res.status !== 200 || !res.json) throw failure(res, 'Token exchange')
  const accessToken = res.json.access_token
  const refreshToken = res.json.refresh_token
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new GoogleApiError('bad_request', 'Token exchange returned no access token')
  }
  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw new GoogleApiError('bad_request', 'Google returned no refresh token; reconnect with consent')
  }
  const scopes = typeof res.json.scope === 'string' ? res.json.scope.split(' ') : []
  if (scopes.length && !scopes.includes(GSC_READ_SCOPE)) {
    throw new GoogleApiError('forbidden', 'Search Console access was not granted')
  }
  let email: string | null = null
  try {
    const info = await request(USERINFO_URL, bearer(accessToken))
    if (info.status === 200 && typeof info.json?.email === 'string') email = info.json.email
  } catch {
    email = null
  }
  return { refreshToken, accessToken, expiresAt: expiryFrom(res.json), email }
}

export async function refreshAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const res = await request(
    TOKEN_URL,
    form({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
  )
  if (res.status !== 200 || !res.json) throw failure(res, 'Token refresh')
  if (typeof res.json.access_token !== 'string' || !res.json.access_token) {
    throw new GoogleApiError('server', 'Token refresh returned no access token')
  }
  return { accessToken: res.json.access_token, expiresAt: expiryFrom(res.json) }
}

/** Best-effort revoke; never throws. Returns whether Google accepted it. */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await request(REVOKE_URL, form({ token }))
    return res.status === 200
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Search Console

export interface GscSite {
  siteUrl: string
  permissionLevel: string
}

export async function listSites(accessToken: string): Promise<GscSite[]> {
  const res = await request(`${WEBMASTERS_URL}/sites`, bearer(accessToken))
  if (res.status !== 200 || !res.json) throw failure(res, 'Listing sites')
  const entries = Array.isArray(res.json.siteEntry) ? res.json.siteEntry : []
  return entries
    .filter((e: any) => typeof e?.siteUrl === 'string')
    .map((e: any) => ({ siteUrl: e.siteUrl as string, permissionLevel: String(e.permissionLevel ?? '') }))
}

export type GscDimension = 'date' | 'query' | 'page'

export interface SearchAnalyticsOptions {
  startDate: string
  endDate: string
  dimensions: GscDimension[]
  rowLimit: number
  dataState?: 'final' | 'all'
}

export interface SearchAnalyticsRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export async function querySearchAnalytics(
  accessToken: string,
  siteUrl: string,
  options: SearchAnalyticsOptions
): Promise<SearchAnalyticsRow[]> {
  const body: Record<string, unknown> = {
    startDate: options.startDate,
    endDate: options.endDate,
    dimensions: options.dimensions,
    rowLimit: Math.min(Math.max(Math.trunc(options.rowLimit), 1), 25_000),
  }
  if (options.dataState) body.dataState = options.dataState
  const url = `${WEBMASTERS_URL}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`
  const res = await request(
    url,
    bearer(accessToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
  if (res.status !== 200 || !res.json) throw failure(res, 'Search analytics query')
  const rows = Array.isArray(res.json.rows) ? res.json.rows : []
  return rows.map((r: any) => ({
    keys: Array.isArray(r.keys) ? r.keys.map(String) : [],
    clicks: Number(r.clicks) || 0,
    impressions: Number(r.impressions) || 0,
    ctr: Number(r.ctr) || 0,
    position: Number(r.position) || 0,
  }))
}

// ---------------------------------------------------------------------------
// Property matching

/**
 * Pick the property for a site origin: exact URL-prefix property (`https://acme.com/`) first,
 * then the domain property (`sc-domain:acme.com`) for the registrable domain, else null.
 * Properties where the user is only `siteUnverifiedUser` are ignored (no data access).
 */
export function matchPropertyForOrigin(origin: string, sites: GscSite[]): GscSite | null {
  const usable = sites.filter(
    (s) => s.permissionLevel !== 'siteUnverifiedUser' && isPropertySelectableForOrigin(origin, s.siteUrl)
  )
  return usable.find((s) => !s.siteUrl.toLowerCase().startsWith('sc-domain:')) ?? usable[0] ?? null
}

/**
 * True when the property corresponds to the site origin: a URL-prefix property whose origin
 * equals the site origin (trailing slash optional, no path; `www.` only when the site itself
 * uses that host) or the `sc-domain:` property for the origin's registrable domain.
 * Anything else (another site, a sub-path property, a different scheme) is not selectable.
 */
export function isPropertySelectableForOrigin(origin: string, propertyUrl: string): boolean {
  let site: URL
  try {
    site = new URL(origin)
  } catch {
    return false
  }
  const value = propertyUrl.trim().toLowerCase()
  if (value.startsWith('sc-domain:')) {
    const domain = getDomain(site.hostname, { allowPrivateDomains: true })
    return !!domain && value === `sc-domain:${domain}`
  }
  let prop: URL
  try {
    prop = new URL(value)
  } catch {
    return false
  }
  if (prop.pathname !== '/' || prop.search || prop.hash || prop.username || prop.password) return false
  return prop.origin === site.origin.toLowerCase()
}
