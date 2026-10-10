/**
 * PageSpeed Insights v5 client. Fixed Google host (no SSRF surface). The API
 * key travels in the query string as Google requires; it is never logged and
 * error messages never include the request URL.
 */

export type PageSpeedField = {
  lcpMs: number | null
  inpMs: number | null
  cls: number | null
  category: 'FAST' | 'AVERAGE' | 'SLOW' | null
} | null

export interface PageSpeedResult {
  performanceScore: number | null
  lab: { lcpMs: number | null; cls: number | null; tbtMs: number | null; fcpMs: number | null }
  field: PageSpeedField
  fetchedAt: string
}

export const PAGESPEED_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'
export const PAGESPEED_TIMEOUT_MS = 60_000

export class PageSpeedError extends Error {
  constructor(
    readonly kind: 'auth' | 'quota' | 'bad_request' | 'failed',
    message: string
  ) {
    super(message)
    this.name = 'PageSpeedError'
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Pure: turns a PSI response body into our result shape. */
export function parsePageSpeed(body: Json, now: Date = new Date()): PageSpeedResult {
  const lh = body?.lighthouseResult ?? {}
  const audits = lh.audits ?? {}
  const score = num(lh.categories?.performance?.score)

  const metrics = body?.loadingExperience?.metrics as Json | undefined
  let field: PageSpeedField = null
  if (metrics && Object.keys(metrics).length > 0) {
    const clsRaw = num(metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile)
    const category = body.loadingExperience?.overall_category
    field = {
      lcpMs: num(metrics.LARGEST_CONTENTFUL_PAINT_MS?.percentile),
      inpMs: num(metrics.INTERACTION_TO_NEXT_PAINT?.percentile),
      // PSI reports field CLS multiplied by 100
      cls: clsRaw === null ? null : clsRaw / 100,
      category: category === 'FAST' || category === 'AVERAGE' || category === 'SLOW' ? category : null,
    }
  }

  return {
    performanceScore: score === null ? null : Math.round(score * 100),
    lab: {
      lcpMs: num(audits['largest-contentful-paint']?.numericValue),
      cls: num(audits['cumulative-layout-shift']?.numericValue),
      tbtMs: num(audits['total-blocking-time']?.numericValue),
      fcpMs: num(audits['first-contentful-paint']?.numericValue),
    },
    field,
    fetchedAt: now.toISOString(),
  }
}

/** True when a 400 body says the key itself is invalid (reason API_KEY_INVALID / "API key not valid"). */
async function indicatesInvalidKey(response: Response): Promise<boolean> {
  let body: Json
  try {
    body = (await response.json()) as Json
  } catch {
    return false
  }
  const error = body?.error
  const details: unknown[] = Array.isArray(error?.details) ? error.details : []
  if (details.some((d) => (d as Json)?.reason === 'API_KEY_INVALID')) return true
  const message = typeof error?.message === 'string' ? error.message : ''
  return /api key (not valid|expired|invalid)/i.test(message)
}

export async function runPageSpeed(
  url: string,
  apiKey: string,
  options: { strategy?: 'mobile' | 'desktop'; signal?: AbortSignal } = {}
): Promise<PageSpeedResult> {
  const params = new URLSearchParams({
    url,
    key: apiKey,
    strategy: options.strategy ?? 'mobile',
    category: 'performance',
  })
  const signals = [AbortSignal.timeout(PAGESPEED_TIMEOUT_MS)]
  if (options.signal) signals.push(options.signal)

  let response: Response
  try {
    response = await fetch(`${PAGESPEED_ENDPOINT}?${params.toString()}`, { signal: AbortSignal.any(signals) })
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    throw new PageSpeedError('failed', timedOut ? 'PageSpeed request timed out' : 'PageSpeed request failed')
  }

  if (response.status === 400) {
    // Google answers 400 both for a bad key and for a bad request (unreachable or unsupported
    // target URL, ...). Only the former is a credential problem.
    if (await indicatesInvalidKey(response)) {
      throw new PageSpeedError('auth', 'PageSpeed rejected the API key')
    }
    throw new PageSpeedError('bad_request', 'PageSpeed could not analyze this URL')
  }
  if (response.status === 403) {
    throw new PageSpeedError('auth', 'PageSpeed rejected the API key or it lacks access')
  }
  if (response.status === 429) throw new PageSpeedError('quota', 'PageSpeed quota exceeded')
  if (!response.ok) throw new PageSpeedError('failed', `PageSpeed returned HTTP ${response.status}`)

  let body: Json
  try {
    body = (await response.json()) as Json
  } catch {
    throw new PageSpeedError('failed', 'PageSpeed returned an invalid response')
  }
  return parsePageSpeed(body)
}
