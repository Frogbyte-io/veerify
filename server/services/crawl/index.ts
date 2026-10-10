import { firecrawlProvider } from './firecrawl'
import type { CrawlProvider, CrawlProviderConfig, CrawlProviderId } from './types'

const providers: Record<CrawlProviderId, CrawlProvider> = { firecrawl: firecrawlProvider }

export function getCrawlProvider(id: CrawlProviderId): CrawlProvider {
  const provider = providers[id]
  if (!provider) throw new Error(`Unknown crawl provider: ${id}`)
  return provider
}

/** Team key first, then the operator's FIRECRAWL_API_KEY. Null when neither is set. */
export function resolveCrawlConfig(teamKey: string | null): CrawlProviderConfig | null {
  const apiKey = teamKey?.trim() || process.env.FIRECRAWL_API_KEY?.trim() || ''
  if (!apiKey) return null
  const baseUrl = (process.env.FIRECRAWL_API_URL?.trim() || 'https://api.firecrawl.dev').replace(/\/+$/, '')
  return { apiKey, baseUrl }
}
