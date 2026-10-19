import { marketingConfig } from '~/server/utils/marketing-config'
import { firecrawlProvider } from './firecrawl'
import type { CrawlProvider, CrawlProviderConfig, CrawlProviderId } from './types'

const providers: Record<CrawlProviderId, CrawlProvider> = { firecrawl: firecrawlProvider }

export function getCrawlProvider(id: CrawlProviderId): CrawlProvider {
  const provider = providers[id]
  if (!provider) throw new Error(`Unknown crawl provider: ${id}`)
  return provider
}

/**
 * Team key first, then the operator's FIRECRAWL_API_KEY (ignored on the cloud unless
 * MARKETING_ALLOW_INSTANCE_KEYS=true). Null when neither applies.
 */
export function resolveCrawlConfig(teamKey: string | null): CrawlProviderConfig | null {
  const apiKey = teamKey?.trim() || marketingConfig.firecrawl.apiKey || ''
  if (!apiKey) return null
  const baseUrl = (process.env.FIRECRAWL_API_URL?.trim() || 'https://api.firecrawl.dev').replace(/\/+$/, '')
  return { apiKey, baseUrl }
}
