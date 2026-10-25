/**
 * Site audit contract: page facts extracted from HTML, site-level facts, and
 * the issues the rules produce. Rules are code, not data, so audit results
 * mean the same thing for every workspace.
 */

export type IssueSeverity = 'error' | 'warning' | 'notice'

export interface PageImage {
  src: string
  alt: string | null
}

/** Facts extracted from one crawled page by `extractPageFacts(url, statusCode, html)` */
export interface PageFacts {
  url: string
  statusCode: number
  title: string | null
  metaDescription: string | null
  canonical: string | null
  /** Lower-cased content of <meta name="robots">, e.g. "noindex, follow" */
  robotsMeta: string | null
  lang: string | null
  h1: string[]
  ogTitle: string | null
  ogDescription: string | null
  ogImage: string | null
  twitterCard: string | null
  /** Absolute same-origin links found on the page, de-duplicated, without fragments */
  internalLinks: string[]
  /** Count of links to other origins */
  externalLinkCount: number
  images: PageImage[]
  /** Parsed JSON-LD blocks; `@type` values collected for reporting */
  jsonLdTypes: string[]
  /** Number of <script type="application/ld+json"> blocks that failed to parse */
  jsonLdErrors: number
  wordCount: number
}

export interface FetchedFile {
  /** HTTP status, or null when the fetch failed entirely */
  status: number | null
  body: string | null
}

/** Site-level inputs, fetched by Veerify itself (basic mode) or alongside a crawl */
export interface SiteFacts {
  origin: string
  robotsTxt: FetchedFile
  llmsTxt: FetchedFile
  sitemapXml: FetchedFile
}

export interface AuditIssue {
  ruleId: string
  severity: IssueSeverity
  /** Null for site-level issues */
  pageUrl: string | null
  /** Rule-specific details for display, e.g. { length: 74, max: 60 } */
  details: Record<string, unknown>
}

export interface AuditRule {
  id: string
  severity: IssueSeverity
  /** Short title, e.g. "Missing meta description" */
  title: string
  /** One or two sentences on how to fix it */
  guidance: string
  scope: 'page' | 'site'
}

export type AiCrawlerVerdict = 'allowed' | 'blocked' | 'partial'

export interface CrawlerAccess {
  /** User-agent token, e.g. "GPTBot" */
  bot: string
  /** Who runs it, e.g. "OpenAI" */
  operator: string
  purpose: 'search' | 'ai-training' | 'ai-search' | 'ai-assistant'
  verdict: AiCrawlerVerdict
}
