import {
  CrawlProviderError,
  type CrawlErrorKind,
  type CrawlJobPage,
  type CrawlJobStatus,
  type CrawlProvider,
  type CrawlProviderConfig,
  type CrawledPage,
  type StartCrawlInput,
} from './types'

/**
 * Firecrawl v2 API.
 * https://docs.firecrawl.dev/api-reference/endpoint/crawl-post
 * https://docs.firecrawl.dev/api-reference/endpoint/crawl-get
 * https://docs.firecrawl.dev/api-reference/endpoint/crawl-delete
 * https://docs.firecrawl.dev/api-reference/endpoint/credit-usage
 */

const REQUEST_TIMEOUT_MS = 30_000

function kindForStatus(status: number): CrawlErrorKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'quota'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'server'
  return 'bad_request'
}

function messageForKind(kind: CrawlErrorKind): string {
  switch (kind) {
    case 'auth':
      return 'Firecrawl rejected the API key'
    case 'quota':
      return 'Firecrawl credits are exhausted'
    case 'rate_limit':
      return 'Firecrawl rate limit reached'
    case 'server':
      return 'Firecrawl had a server error'
    default:
      return 'Firecrawl rejected the request'
  }
}

async function request(
  config: CrawlProviderConfig,
  url: string,
  init: { method: string; body?: unknown; signal?: AbortSignal }
): Promise<Record<string, unknown>> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  let response: Response
  try {
    response = await fetch(url, {
      method: init.method,
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal,
    })
  } catch (error) {
    if (timeout.aborted) throw new CrawlProviderError('firecrawl', 'timeout', 'Firecrawl request timed out')
    if (init.signal?.aborted) throw error
    throw new CrawlProviderError('firecrawl', 'network', 'Could not reach Firecrawl')
  }
  let json: Record<string, unknown> = {}
  try {
    const parsed = await response.json()
    if (parsed && typeof parsed === 'object') json = parsed as Record<string, unknown>
  } catch {
    // non-JSON body
  }
  if (!response.ok) {
    const kind = kindForStatus(response.status)
    const detail = typeof json.error === 'string' ? `: ${json.error}` : ''
    throw new CrawlProviderError('firecrawl', kind, `${messageForKind(kind)}${detail}`.slice(0, 300), response.status)
  }
  return json
}

function mapStatus(status: unknown): CrawlJobStatus {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'running' // "scraping" and anything unknown
  }
}

function mapPage(item: unknown): CrawledPage | null {
  if (!item || typeof item !== 'object') return null
  const data = item as Record<string, unknown>
  const metadata = (data.metadata && typeof data.metadata === 'object' ? data.metadata : {}) as Record<string, unknown>
  const sourceUrl = typeof metadata.sourceURL === 'string' ? metadata.sourceURL : undefined
  const url = typeof metadata.url === 'string' ? metadata.url : sourceUrl
  if (!url) return null
  const html =
    typeof data.rawHtml === 'string' ? data.rawHtml : typeof data.html === 'string' ? (data.html as string) : null
  const page: CrawledPage = {
    url,
    statusCode: typeof metadata.statusCode === 'number' ? metadata.statusCode : 0,
    html,
  }
  if (sourceUrl && sourceUrl !== url) page.sourceUrl = sourceUrl
  if (typeof metadata.error === 'string' && metadata.error) page.error = metadata.error
  return page
}

function assertSameOrigin(config: CrawlProviderConfig, cursor: string): string {
  let next: URL
  let base: URL
  try {
    base = new URL(config.baseUrl)
    next = new URL(cursor)
  } catch {
    throw new CrawlProviderError('firecrawl', 'bad_request', 'Invalid pagination cursor')
  }
  if (next.origin !== base.origin) {
    throw new CrawlProviderError('firecrawl', 'bad_request', 'Pagination cursor points to a different host')
  }
  return next.toString()
}

export const firecrawlProvider: CrawlProvider = {
  id: 'firecrawl',
  label: 'Firecrawl',

  async validateKey(config, signal) {
    try {
      await request(config, `${config.baseUrl}/v2/team/credit-usage`, { method: 'GET', signal })
      return { ok: true }
    } catch (error) {
      if (error instanceof CrawlProviderError) return { ok: false, kind: error.kind, message: error.message }
      throw error
    }
  },

  async startCrawl(config, input: StartCrawlInput) {
    const json = await request(config, `${config.baseUrl}/v2/crawl`, {
      method: 'POST',
      signal: input.signal,
      body: {
        url: input.url,
        limit: input.limit,
        allowExternalLinks: false,
        allowSubdomains: false,
        crawlEntireDomain: true,
        scrapeOptions: { formats: ['rawHtml'] },
      },
    })
    if (typeof json.id !== 'string' || !json.id) {
      throw new CrawlProviderError('firecrawl', 'server', 'Firecrawl did not return a crawl id')
    }
    return { jobId: json.id }
  },

  async getCrawl(config, jobId, cursor, signal): Promise<CrawlJobPage> {
    const url = cursor ? assertSameOrigin(config, cursor) : `${config.baseUrl}/v2/crawl/${encodeURIComponent(jobId)}`
    const json = await request(config, url, { method: 'GET', signal })
    const pages = (Array.isArray(json.data) ? json.data : [])
      .map(mapPage)
      .filter((page): page is CrawledPage => page !== null)
    const result: CrawlJobPage = { status: mapStatus(json.status), pages }
    if (typeof json.next === 'string' && json.next) result.next = json.next
    if (typeof json.completed === 'number') result.completed = json.completed
    if (typeof json.total === 'number') result.total = json.total
    if (typeof json.error === 'string') result.error = json.error
    return result
  },

  async cancelCrawl(config, jobId) {
    await request(config, `${config.baseUrl}/v2/crawl/${encodeURIComponent(jobId)}`, { method: 'DELETE' })
  },
}
