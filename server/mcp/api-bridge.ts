/**
 * Bridge from MCP tools to the dashboard API. Requests run in-process through Nitro's
 * `$fetch`, so every call goes through the normal route stack (auth, access checks,
 * rate limit) as the API key's owner.
 */
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import type { ApiCaller } from './types'

/** Paths `call_api` never reaches (Global Constraints). Matched per path segment, case-insensitively. */
export const BLOCKED_API_PREFIXES = [
  '/api/auth',
  '/api/cron',
  '/api/public/auth',
  '/api/user/api-keys',
  '/api/test',
] as const

// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\\\u0000-\u001f\u007f]/

/**
 * Canonicalises an API path: decodes percent-encoding once, resolves `.`/`..`, collapses
 * empty segments and re-encodes each segment. Returns null for absolute or relative URLs,
 * malformed or double encoding, `;`, non-ASCII, traversal above the root, or anything outside `/api/`.
 * The query string (if any) is kept verbatim; a fragment is dropped.
 */
export function normalizeApiPath(path: string): string | null {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return null
  if (UNSAFE_CHARS.test(path)) return null

  const withoutHash = path.split('#', 1)[0]!
  const queryIndex = withoutHash.indexOf('?')
  const rawPath = queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex)
  const query = queryIndex === -1 ? '' : withoutHash.slice(queryIndex + 1)

  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return null
  }
  // A second layer of encoding, an encoded `?`/`#`/backslash, `;` path parameters and
  // non-ASCII (fullwidth dots, lone surrogates) are never legitimate in a route path.
  if (/[%?#;]/.test(decoded) || UNSAFE_CHARS.test(decoded) || /[^\x20-\x7e]/.test(decoded)) return null

  const segments: string[] = []
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length === 0) return null
      segments.pop()
      continue
    }
    segments.push(segment)
  }

  if (segments.length < 2 || segments[0]!.toLowerCase() !== 'api') return null

  let normalized: string
  try {
    normalized = '/' + segments.map((segment) => encodeURIComponent(segment)).join('/')
  } catch {
    return null
  }
  return query ? `${normalized}?${query}` : normalized
}

/** True when a normalized path equals or sits under a blocked prefix (case-insensitive). */
export function isBlockedApiPath(normalized: string): boolean {
  const pathOnly = normalized.split('?', 1)[0]!.toLowerCase()
  return BLOCKED_API_PREFIXES.some((prefix) => pathOnly === prefix || pathOnly.startsWith(`${prefix}/`))
}

function contextHeadersOnly(headers: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    const key = name.toLowerCase()
    if (key.startsWith('x-veerify-') && typeof value === 'string') result[key] = value
  }
  return result
}

export interface ApiCallerOptions {
  /**
   * The original caller's IP (see `getClientIp`). Sent as `x-forwarded-for` so IP-based rate
   * limits on in-process calls bucket per client instead of sharing one `'unknown'` bucket.
   */
  clientIp?: string
}

/**
 * Creates the `callApi` used by tools. Only `authorization`, `x-veerify-*` and the
 * `x-forwarded-for` derived from `options.clientIp` are forwarded (never cookies). A per-call
 * `headers` map is merged over the inherited context headers; `inheritContext: false` drops
 * the inherited ones for that call.
 */
export function createApiCaller(
  authorization: string,
  contextHeaders: Record<string, string>,
  options: ApiCallerOptions = {}
): ApiCaller {
  const inherited = contextHeadersOnly(contextHeaders)
  const forwardedFor: Record<string, string> = options.clientIp ? { 'x-forwarded-for': options.clientIp } : {}

  return async ({ method, path, query, body, headers, inheritContext = true }) => {
    const normalized = normalizeApiPath(path)
    if (normalized === null || isBlockedApiPath(normalized)) {
      return {
        status: 403,
        body: createErrorResponse(ErrorCode.FORBIDDEN, 'This path cannot be called with a personal API key'),
      }
    }

    const response = await $fetch.raw(normalized, {
      method,
      query,
      body: body as Record<string, unknown> | undefined,
      headers: { ...(inheritContext ? inherited : {}), ...contextHeadersOnly(headers), ...forwardedFor, authorization },
      ignoreResponseError: true,
    })
    return { status: response.status, body: response._data ?? null }
  }
}
