/**
 * Crawl provider contract for the marketing site audit.
 *
 * Veerify does not run its own crawler. A provider (Firecrawl first) crawls the
 * verified site asynchronously; the `marketing:audit-advance` scheduled task
 * polls the job and stores pages as they arrive.
 */

export type CrawlProviderId = 'firecrawl'

export interface CrawlProviderConfig {
  apiKey: string
  /** Provider API base URL. Self-hosted Firecrawl installs point this at their own instance. */
  baseUrl: string
}

export interface StartCrawlInput {
  /** Origin or start URL of the verified site */
  url: string
  /** Hard page cap for the job */
  limit: number
  signal?: AbortSignal
}

export interface CrawledPage {
  /** Final URL of the page after redirects */
  url: string
  /** URL as discovered, when different from `url` (redirected) */
  sourceUrl?: string
  statusCode: number
  /** Raw HTML. Null when the provider could not return it for this page. */
  html: string | null
  /** Provider-reported error for this page, if any */
  error?: string
}

export type CrawlJobStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface CrawlJobPage {
  status: CrawlJobStatus
  /** Pages in this batch. Callers persist them; the provider may not return them again. */
  pages: CrawledPage[]
  /** Opaque cursor for the next batch of the same job; undefined when there is none yet */
  next?: string
  /** Provider's counts, when it reports them */
  completed?: number
  total?: number
  error?: string
}

export type CrawlErrorKind = 'auth' | 'rate_limit' | 'quota' | 'bad_request' | 'server' | 'network' | 'timeout'

export class CrawlProviderError extends Error {
  constructor(
    readonly provider: CrawlProviderId,
    readonly kind: CrawlErrorKind,
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'CrawlProviderError'
  }
}

export interface CrawlProvider {
  id: CrawlProviderId
  label: string
  validateKey(
    config: CrawlProviderConfig,
    signal?: AbortSignal
  ): Promise<{ ok: boolean; kind?: CrawlErrorKind; message?: string }>
  startCrawl(config: CrawlProviderConfig, input: StartCrawlInput): Promise<{ jobId: string }>
  /** Fetch job status and the next batch of pages. Pass the previous `next` cursor to continue. */
  getCrawl(config: CrawlProviderConfig, jobId: string, cursor?: string, signal?: AbortSignal): Promise<CrawlJobPage>
  cancelCrawl(config: CrawlProviderConfig, jobId: string): Promise<void>
}
