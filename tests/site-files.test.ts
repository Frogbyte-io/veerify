import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchHomePage, fetchSiteFacts } from '../server/services/marketing/site-files'

const safeFetchText = vi.hoisted(() => vi.fn())
vi.mock('../server/utils/safe-fetch', () => ({ safeFetchText }))

function ok(body: string, status = 200, finalUrl = 'https://acme.com/') {
  return { status, body, finalUrl, headers: {}, truncated: false, contentType: null }
}

beforeEach(() => {
  safeFetchText.mockReset()
})

describe('fetchSiteFacts', () => {
  it('fetches robots, llms and the default sitemap', async () => {
    safeFetchText.mockImplementation(async (url: string) => {
      if (url.endsWith('/robots.txt')) return ok('User-agent: *\nDisallow:')
      if (url.endsWith('/llms.txt')) return ok('# Acme', 404)
      return ok('<urlset/>')
    })
    const facts = await fetchSiteFacts('https://acme.com', { userAgent: 'VeerifyBot' })
    expect(facts).toEqual({
      origin: 'https://acme.com',
      robotsTxt: { status: 200, body: 'User-agent: *\nDisallow:' },
      llmsTxt: { status: 404, body: '# Acme' },
      sitemapXml: { status: 200, body: '<urlset/>' },
    })
    expect(safeFetchText.mock.calls.map((c) => c[0])).toContain('https://acme.com/sitemap.xml')
    expect(safeFetchText.mock.calls[0][1].userAgent).toBe('VeerifyBot')
  })

  it('uses the first same-site Sitemap line from robots.txt', async () => {
    safeFetchText.mockImplementation(async (url: string) => {
      if (url.endsWith('/robots.txt'))
        return ok('Sitemap: https://other.com/s.xml\nsitemap: https://www.acme.com/sitemap_index.xml')
      return ok('x')
    })
    await fetchSiteFacts('https://acme.com')
    expect(safeFetchText.mock.calls.map((c) => c[0])).toContain('https://www.acme.com/sitemap_index.xml')
    expect(safeFetchText.mock.calls.map((c) => c[0])).not.toContain('https://acme.com/sitemap.xml')
  })

  it('captures failures instead of throwing', async () => {
    safeFetchText.mockRejectedValue(new Error('boom'))
    const facts = await fetchSiteFacts('https://acme.com')
    expect(facts.robotsTxt).toEqual({ status: null, body: null })
    expect(facts.llmsTxt).toEqual({ status: null, body: null })
    expect(facts.sitemapXml).toEqual({ status: null, body: null })
  })
})

describe('fetchHomePage', () => {
  it('returns a CrawledPage shape', async () => {
    safeFetchText.mockResolvedValue(ok('<html></html>', 200, 'https://www.acme.com/'))
    expect(await fetchHomePage('https://acme.com')).toEqual({
      url: 'https://www.acme.com/',
      statusCode: 200,
      html: '<html></html>',
    })
  })
})
