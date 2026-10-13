import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCrawlProvider, resolveCrawlConfig } from '../server/services/crawl'
import { firecrawlProvider } from '../server/services/crawl/firecrawl'
import { CrawlProviderError } from '../server/services/crawl/types'

const config = { apiKey: 'fc-secret-key', baseUrl: 'https://fc.example.com' }
const fetchMock = vi.fn()

function reply(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }))
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('firecrawl provider', () => {
  it('starts a crawl with rawHtml, same-site only', async () => {
    reply(200, { success: true, id: 'job-1', url: 'x' })
    const { jobId } = await firecrawlProvider.startCrawl(config, { url: 'https://acme.com', limit: 50 })
    expect(jobId).toBe('job-1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://fc.example.com/v2/crawl')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer fc-secret-key')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      url: 'https://acme.com',
      limit: 50,
      allowExternalLinks: false,
      allowSubdomains: false,
      scrapeOptions: { formats: ['rawHtml'] },
    })
  })

  it('maps crawl status and pages', async () => {
    reply(200, {
      status: 'scraping',
      total: 5,
      completed: 2,
      next: 'https://fc.example.com/v2/crawl/job-1?skip=2',
      data: [
        {
          rawHtml: '<h1>a</h1>',
          metadata: { statusCode: 200, url: 'https://acme.com/', sourceURL: 'https://acme.com' },
        },
        { html: '<p>b</p>', metadata: { statusCode: 404, sourceURL: 'https://acme.com/x', error: 'Not found' } },
        { metadata: {} },
      ],
    })
    const page = await firecrawlProvider.getCrawl(config, 'job-1')
    expect(page).toMatchObject({ status: 'running', total: 5, completed: 2 })
    expect(page.next).toBe('https://fc.example.com/v2/crawl/job-1?skip=2')
    expect(page.pages).toEqual([
      { url: 'https://acme.com/', sourceUrl: 'https://acme.com', statusCode: 200, html: '<h1>a</h1>' },
      { url: 'https://acme.com/x', statusCode: 404, html: '<p>b</p>', error: 'Not found' },
    ])
    expect(fetchMock.mock.calls[0][0]).toBe('https://fc.example.com/v2/crawl/job-1')
  })

  it('maps terminal statuses', async () => {
    reply(200, { status: 'completed', data: [] })
    expect((await firecrawlProvider.getCrawl(config, 'j')).status).toBe('completed')
    reply(200, { status: 'failed', data: [] })
    expect((await firecrawlProvider.getCrawl(config, 'j')).status).toBe('failed')
  })

  it('rebases a cursor onto the configured base URL and rejects other paths', async () => {
    reply(200, { status: 'completed', data: [] })
    await firecrawlProvider.getCrawl(config, 'j', 'https://fc.example.com/v2/crawl/j?skip=10')
    expect(fetchMock.mock.calls[0][0]).toBe('https://fc.example.com/v2/crawl/j?skip=10')

    reply(200, { status: 'completed', data: [] })
    await firecrawlProvider.getCrawl(config, 'j', 'http://internal:3002/v2/crawl/j?skip=20')
    expect(fetchMock.mock.calls[1][0]).toBe('https://fc.example.com/v2/crawl/j?skip=20')

    await expect(firecrawlProvider.getCrawl(config, 'j', 'https://evil.example/steal')).rejects.toMatchObject({
      kind: 'bad_request',
    })
    await expect(firecrawlProvider.getCrawl(config, 'j', 'https://fc.example.com/v2/crawl/../x')).rejects.toMatchObject(
      {
        kind: 'bad_request',
      }
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('cancels with DELETE', async () => {
    reply(200, { status: 'cancelled' })
    await firecrawlProvider.cancelCrawl(config, 'job-1')
    expect(fetchMock.mock.calls[0][0]).toBe('https://fc.example.com/v2/crawl/job-1')
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
  })

  it.each([
    [401, 'auth'],
    [402, 'quota'],
    [429, 'rate_limit'],
    [500, 'server'],
    [400, 'bad_request'],
  ])('maps HTTP %i to %s without leaking the key', async (status, kind) => {
    reply(status, { error: 'boom' })
    const error = await firecrawlProvider
      .startCrawl(config, { url: 'https://acme.com', limit: 1 })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CrawlProviderError)
    expect(error).toMatchObject({ kind, status })
    expect((error as Error).message).not.toContain('fc-secret-key')
  })

  it('redacts the API key from provider error text and truncates', async () => {
    reply(400, { error: `bad key fc-secret-key and Bearer fc-secret-key ${'x'.repeat(1000)}` })
    const error = (await firecrawlProvider
      .startCrawl(config, { url: 'https://acme.com', limit: 1 })
      .catch((e: unknown) => e)) as Error
    expect(error.message).not.toContain('fc-secret-key')
    expect(error.message).toContain('[redacted]')
    expect(error.message.length).toBeLessThanOrEqual(310)
  })

  it('maps network failures and timeouts', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(firecrawlProvider.startCrawl(config, { url: 'https://a.com', limit: 1 })).rejects.toMatchObject({
      kind: 'network',
    })
    fetchMock.mockImplementationOnce((_url: string, init: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'TimeoutError')))
      })
    })
    const controller = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    const pending = firecrawlProvider.startCrawl(config, { url: 'https://a.com', limit: 1 }).catch((e: unknown) => e)
    controller.abort()
    expect(await pending).toMatchObject({ kind: 'timeout' })
  })

  it('validateKey uses the credit usage endpoint', async () => {
    reply(200, { success: true, data: { remainingCredits: 10 } })
    expect(await firecrawlProvider.validateKey(config)).toEqual({ ok: true })
    expect(fetchMock.mock.calls[0][0]).toBe('https://fc.example.com/v2/team/credit-usage')
    expect(fetchMock.mock.calls[0][1].method).toBe('GET')

    reply(401, { error: 'Unauthorized' })
    expect(await firecrawlProvider.validateKey(config)).toMatchObject({ ok: false, kind: 'auth' })
  })
})

describe('resolveCrawlConfig', () => {
  it('prefers the team key and trims the base URL', () => {
    vi.stubEnv('FIRECRAWL_API_KEY', 'env-key')
    vi.stubEnv('FIRECRAWL_API_URL', 'http://firecrawl:3002/')
    expect(resolveCrawlConfig('team-key')).toEqual({ apiKey: 'team-key', baseUrl: 'http://firecrawl:3002' })
    expect(resolveCrawlConfig(null)).toEqual({ apiKey: 'env-key', baseUrl: 'http://firecrawl:3002' })
  })

  it('defaults the base URL and returns null without any key', () => {
    vi.stubEnv('FIRECRAWL_API_KEY', '')
    vi.stubEnv('FIRECRAWL_API_URL', '')
    expect(resolveCrawlConfig(null)).toBeNull()
    expect(resolveCrawlConfig('k')).toEqual({ apiKey: 'k', baseUrl: 'https://api.firecrawl.dev' })
    expect(getCrawlProvider('firecrawl').id).toBe('firecrawl')
  })
})
