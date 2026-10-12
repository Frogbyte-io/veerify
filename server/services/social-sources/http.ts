import { SocialSourceError, type SocialSourceId } from './types'

export const REQUEST_TIMEOUT_MS = 15_000
export const MAX_TEXT_LENGTH = 2000

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
}

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole
      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

export function truncate(text: string, max = MAX_TEXT_LENGTH): string {
  return text.length > max ? text.slice(0, max) : text
}

/** Strip HTML tags (HN comments use <p>, <a>, <pre><code>, <i>), decode entities, truncate. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return ''
  const stripped = html
    .replace(/<\s*(p|br)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[ \t]+\n/g, '\n')
  return truncate(decodeEntities(stripped).trim())
}

/** Decode entities only (for sources that return plain text with escaped entities). */
export function plainText(text: string | null | undefined): string {
  return text ? truncate(decodeEntities(text).trim()) : ''
}

/**
 * fetch with a per-request timeout combined with the caller's signal.
 * Network and timeout failures become SocialSourceError; HTTP status is left to the caller.
 */
export async function timedFetch(
  source: SocialSourceId,
  url: string,
  init: RequestInit,
  callerSignal?: AbortSignal
): Promise<Response> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = callerSignal ? AbortSignal.any([timeout, callerSignal]) : timeout
  try {
    return await fetch(url, { ...init, signal })
  } catch (err) {
    if (timeout.aborted) {
      throw new SocialSourceError(source, 'timeout', `${source} request timed out`)
    }
    if (callerSignal?.aborted) {
      throw new SocialSourceError(source, 'network', `${source} request aborted`)
    }
    throw new SocialSourceError(
      source,
      'network',
      `${source} request failed: ${err instanceof Error ? err.message : 'unknown error'}`
    )
  }
}

/** Map a non-OK HTTP response to a SocialSourceError. Never includes headers/credentials. */
export function httpError(source: SocialSourceId, status: number): SocialSourceError {
  if (status === 401 || status === 403) {
    return new SocialSourceError(source, 'auth', `${source} rejected credentials (${status})`, status)
  }
  if (status === 429) {
    return new SocialSourceError(source, 'rate_limit', `${source} rate limit reached`, status)
  }
  return new SocialSourceError(source, 'server', `${source} returned HTTP ${status}`, status)
}

export async function readJson<T>(source: SocialSourceId, res: Response): Promise<T> {
  try {
    return (await res.json()) as T
  } catch {
    throw new SocialSourceError(source, 'server', `${source} returned invalid JSON`, res.status)
  }
}
