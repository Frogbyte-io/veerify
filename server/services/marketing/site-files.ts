import { safeFetchText } from '~/server/utils/safe-fetch'
import type { FetchedFile, SiteFacts } from './audit/types'
import type { CrawledPage } from '../crawl/types'

interface FetchOptions {
  userAgent?: string
}

async function fetchFile(url: string, options: FetchOptions, accept = 'text/plain,*/*;q=0.5'): Promise<FetchedFile> {
  try {
    const result = await safeFetchText(url, { userAgent: options.userAgent, accept, maxBytes: 1_000_000 })
    return { status: result.status, body: result.body }
  } catch {
    return { status: null, body: null }
  }
}

function sameSite(a: string, b: string): boolean {
  const strip = (host: string) => host.toLowerCase().replace(/^www\./, '')
  return strip(a) === strip(b)
}

function firstSitemapFromRobots(robots: string | null, origin: string): string | null {
  if (!robots) return null
  const host = new URL(origin).hostname
  for (const line of robots.split(/\r?\n/)) {
    const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(line)
    if (!match) continue
    try {
      const url = new URL(match[1], origin)
      if (['http:', 'https:'].includes(url.protocol) && sameSite(url.hostname, host)) return url.toString()
    } catch {
      // ignore malformed entry
    }
  }
  return null
}

export async function fetchSiteFacts(origin: string, options: FetchOptions = {}): Promise<SiteFacts> {
  const base = new URL(origin).origin
  const [robotsTxt, llmsTxt] = await Promise.all([
    fetchFile(`${base}/robots.txt`, options),
    fetchFile(`${base}/llms.txt`, options),
  ])
  const sitemapUrl = firstSitemapFromRobots(robotsTxt.body, base) || `${base}/sitemap.xml`
  const sitemapXml = await fetchFile(sitemapUrl, options, 'application/xml,text/xml,*/*;q=0.5')
  return { origin: base, robotsTxt, llmsTxt, sitemapXml }
}

export async function fetchHomePage(origin: string, options: FetchOptions = {}): Promise<CrawledPage> {
  const base = new URL(origin).origin
  const result = await safeFetchText(`${base}/`, { userAgent: options.userAgent, accept: 'text/html,*/*;q=0.5' })
  return { url: result.finalUrl, statusCode: result.status, html: result.body }
}
