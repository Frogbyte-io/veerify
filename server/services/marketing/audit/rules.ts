import { validateLlmsTxt } from './llms-txt'
import { crawlerAccess, robotsSitemaps } from './robots'
import { parseSitemap } from './sitemap'
import type { AuditIssue, AuditRule, FetchedFile, PageFacts, SiteFacts } from './types'

export const TITLE_MIN_LENGTH = 10
export const TITLE_MAX_LENGTH = 60
export const META_DESCRIPTION_MIN_LENGTH = 50
export const META_DESCRIPTION_MAX_LENGTH = 160
export const THIN_CONTENT_WORDS = 200
export const MAX_BROKEN_LINK_TARGETS = 10
export const MAX_SITEMAP_MISSING_SAMPLE = 20
const MAX_DUPLICATE_PAGES_LISTED = 5

type Details = Record<string, unknown>

interface PageContext {
  pages: PageFacts[]
  byUrl: Map<string, PageFacts>
  /** Normalised value -> pages sharing it, among pages that returned 2xx */
  titleGroups: Map<string, PageFacts[]>
  descriptionGroups: Map<string, PageFacts[]>
}

interface PageRuleDef extends AuditRule {
  scope: 'page'
  /** Returns issue details when the page violates the rule, otherwise null */
  check: (page: PageFacts, ctx: PageContext) => Details | null
}

interface SiteRuleDef extends AuditRule {
  scope: 'site'
  /** Returns one details object per issue to raise */
  check: (site: SiteFacts, pages: PageFacts[]) => Details[]
}

/** Strips the fragment and trailing slash (except root) so URLs compare equal. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    u.hash = ''
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1)
    return u.href
  } catch {
    return raw
  }
}

function isHome(page: PageFacts): boolean {
  try {
    const u = new URL(page.url)
    return u.pathname === '/' && u.search === ''
  } catch {
    return false
  }
}

function isOk(page: PageFacts): boolean {
  return page.statusCode >= 200 && page.statusCode < 300
}

function groupBy(pages: PageFacts[], pick: (p: PageFacts) => string | null) {
  const groups = new Map<string, PageFacts[]>()
  for (const page of pages) {
    if (!isOk(page)) continue
    const raw = pick(page)
    if (!raw) continue
    const key = raw.trim().toLowerCase()
    const list = groups.get(key)
    if (list) list.push(page)
    else groups.set(key, [page])
  }
  return groups
}

function duplicateDetails(value: string, page: PageFacts, groups: Map<string, PageFacts[]>): Details | null {
  const group = groups.get(value.trim().toLowerCase())
  if (!group || group.length < 2) return null
  const others = group.filter((p) => p !== page).map((p) => p.url)
  return {
    value,
    count: group.length,
    otherPages: others.slice(0, MAX_DUPLICATE_PAGES_LISTED),
  }
}

function hasNoindex(page: PageFacts): boolean {
  if (!page.robotsMeta) return false
  return page.robotsMeta.split(/[\s,]+/).some((t) => t === 'noindex' || t === 'none')
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b, a).origin
  } catch {
    return true
  }
}

const lengthRule = (
  id: string,
  severity: AuditRule['severity'],
  title: string,
  guidance: string,
  get: (p: PageFacts) => string | null,
  test: (length: number) => Details | null
): PageRuleDef => ({
  id,
  severity,
  title,
  guidance,
  scope: 'page',
  check: (page) => {
    const value = get(page)
    return value === null ? null : test(value.length)
  },
})

const PAGE_RULES: PageRuleDef[] = [
  {
    id: 'http-error',
    severity: 'error',
    title: 'Page returns an HTTP error',
    guidance: 'Fix or remove the page, or redirect it to a working URL. Remove internal links that point to it.',
    scope: 'page',
    check: (p) => (p.statusCode >= 400 ? { statusCode: p.statusCode } : null),
  },
  {
    id: 'title-missing',
    severity: 'error',
    title: 'Missing title',
    guidance: 'Add a unique, descriptive <title> to the page.',
    scope: 'page',
    check: (p) => (p.title === null ? {} : null),
  },
  lengthRule(
    'title-too-short',
    'warning',
    'Title too short',
    `Use a more descriptive title of at least ${TITLE_MIN_LENGTH} characters.`,
    (p) => p.title,
    (length) => (length < TITLE_MIN_LENGTH ? { length, min: TITLE_MIN_LENGTH } : null)
  ),
  lengthRule(
    'title-too-long',
    'warning',
    'Title too long',
    `Keep titles under ${TITLE_MAX_LENGTH} characters so search results do not truncate them.`,
    (p) => p.title,
    (length) => (length > TITLE_MAX_LENGTH ? { length, max: TITLE_MAX_LENGTH } : null)
  ),
  {
    id: 'title-duplicate',
    severity: 'warning',
    title: 'Duplicate title',
    guidance: 'Give every page its own title that describes what is unique about it.',
    scope: 'page',
    check: (p, ctx) => (p.title && isOk(p) ? duplicateDetails(p.title, p, ctx.titleGroups) : null),
  },
  {
    id: 'meta-description-missing',
    severity: 'warning',
    title: 'Missing meta description',
    guidance: 'Add a meta description that summarises the page in one or two sentences.',
    scope: 'page',
    check: (p) => (p.metaDescription === null ? {} : null),
  },
  lengthRule(
    'meta-description-too-short',
    'notice',
    'Meta description too short',
    `Expand the description to at least ${META_DESCRIPTION_MIN_LENGTH} characters.`,
    (p) => p.metaDescription,
    (length) => (length < META_DESCRIPTION_MIN_LENGTH ? { length, min: META_DESCRIPTION_MIN_LENGTH } : null)
  ),
  lengthRule(
    'meta-description-too-long',
    'notice',
    'Meta description too long',
    `Keep descriptions under ${META_DESCRIPTION_MAX_LENGTH} characters so they are not truncated.`,
    (p) => p.metaDescription,
    (length) => (length > META_DESCRIPTION_MAX_LENGTH ? { length, max: META_DESCRIPTION_MAX_LENGTH } : null)
  ),
  {
    id: 'meta-description-duplicate',
    severity: 'warning',
    title: 'Duplicate meta description',
    guidance: 'Write a distinct meta description for each page.',
    scope: 'page',
    check: (p, ctx) =>
      p.metaDescription && isOk(p) ? duplicateDetails(p.metaDescription, p, ctx.descriptionGroups) : null,
  },
  {
    id: 'h1-missing',
    severity: 'warning',
    title: 'Missing H1',
    guidance: 'Add a single H1 heading that states what the page is about.',
    scope: 'page',
    check: (p) => (p.h1.filter((h) => h !== '').length === 0 ? {} : null),
  },
  {
    id: 'h1-multiple',
    severity: 'notice',
    title: 'Multiple H1 headings',
    guidance: 'Use one H1 per page and H2 to H6 for sub-headings.',
    scope: 'page',
    check: (p) => (p.h1.length > 1 ? { count: p.h1.length } : null),
  },
  {
    id: 'canonical-missing',
    severity: 'notice',
    title: 'Missing canonical URL',
    guidance: 'Add <link rel="canonical"> pointing at the preferred URL of the page.',
    scope: 'page',
    check: (p) => (p.canonical === null ? {} : null),
  },
  {
    id: 'canonical-cross-origin',
    severity: 'warning',
    title: 'Canonical points to another site',
    guidance:
      'The canonical tells search engines to index a different domain instead of this page. Point it at this site unless that is intended.',
    scope: 'page',
    check: (p) => (p.canonical && !sameOrigin(p.url, p.canonical) ? { canonical: p.canonical } : null),
  },
  {
    id: 'noindex',
    severity: 'warning',
    title: 'Page is set to noindex',
    guidance:
      'Search engines will not index this page. Remove the noindex directive if the page should appear in search.',
    scope: 'page',
    check: (p) => (hasNoindex(p) ? { robots: p.robotsMeta } : null),
  },
  {
    id: 'lang-missing',
    severity: 'notice',
    title: 'Missing html lang attribute',
    guidance: 'Set the language on the <html> element, for example <html lang="en">.',
    scope: 'page',
    check: (p) => (p.lang === null ? {} : null),
  },
  {
    id: 'og-title-missing',
    severity: 'notice',
    title: 'Missing og:title',
    guidance: 'Add <meta property="og:title"> so links preview well when shared.',
    scope: 'page',
    check: (p) => (p.ogTitle === null ? {} : null),
  },
  {
    id: 'og-description-missing',
    severity: 'notice',
    title: 'Missing og:description',
    guidance: 'Add <meta property="og:description"> so links preview well when shared.',
    scope: 'page',
    check: (p) => (p.ogDescription === null ? {} : null),
  },
  {
    id: 'og-image-missing',
    severity: 'notice',
    title: 'Missing og:image',
    guidance: 'Add <meta property="og:image"> with an absolute URL to a 1200x630 image.',
    scope: 'page',
    check: (p) => (p.ogImage === null ? {} : null),
  },
  {
    id: 'twitter-card-missing',
    severity: 'notice',
    title: 'Missing twitter:card',
    guidance: 'Add <meta name="twitter:card" content="summary_large_image"> for X/Twitter previews.',
    scope: 'page',
    check: (p) => (p.twitterCard === null ? {} : null),
  },
  {
    id: 'images-missing-alt',
    severity: 'warning',
    title: 'Images without alt text',
    guidance: 'Describe each informative image with an alt attribute. Use alt="" for purely decorative images.',
    scope: 'page',
    check: (p) => {
      const missing = p.images.filter((i) => i.alt === null)
      return missing.length ? { count: missing.length, total: p.images.length } : null
    },
  },
  {
    id: 'json-ld-invalid',
    severity: 'warning',
    title: 'Invalid JSON-LD structured data',
    guidance: 'One or more JSON-LD blocks are not valid JSON. Validate them and fix syntax errors.',
    scope: 'page',
    check: (p) => (p.jsonLdErrors > 0 ? { count: p.jsonLdErrors } : null),
  },
  {
    id: 'structured-data-missing',
    severity: 'notice',
    title: 'No structured data on the home page',
    guidance:
      'Add JSON-LD such as Organization or WebSite to the home page to help search engines and AI assistants understand the site.',
    scope: 'page',
    check: (p) => (isHome(p) && isOk(p) && p.jsonLdTypes.length === 0 && p.jsonLdErrors === 0 ? {} : null),
  },
  {
    id: 'thin-content',
    severity: 'notice',
    title: 'Thin content',
    guidance: `Pages with fewer than ${THIN_CONTENT_WORDS} words rarely rank. Add useful content or consolidate the page.`,
    scope: 'page',
    check: (p) => (p.wordCount < THIN_CONTENT_WORDS ? { wordCount: p.wordCount, min: THIN_CONTENT_WORDS } : null),
  },
  {
    id: 'broken-internal-links',
    severity: 'error',
    title: 'Broken internal links',
    guidance: 'Update or remove links that point to pages returning an error.',
    scope: 'page',
    check: (p, ctx) => {
      const broken: { url: string; statusCode: number }[] = []
      const seen = new Set<string>()
      for (const link of p.internalLinks) {
        const key = normalizeUrl(link)
        if (seen.has(key)) continue
        seen.add(key)
        const target = ctx.byUrl.get(key)
        if (target && target.statusCode >= 400) {
          broken.push({ url: link, statusCode: target.statusCode })
        }
      }
      return broken.length ? { count: broken.length, targets: broken.slice(0, MAX_BROKEN_LINK_TARGETS) } : null
    },
  },
]

function ok(file: FetchedFile): file is FetchedFile & { body: string } {
  return file.status !== null && file.status >= 200 && file.status < 300 && file.body !== null
}

function robotsBody(site: SiteFacts): string | null {
  return ok(site.robotsTxt) ? site.robotsTxt.body : null
}

const SEARCH_BOTS = new Set(['Googlebot', 'Bingbot'])

const SITE_RULES: SiteRuleDef[] = [
  {
    id: 'robots-txt-missing',
    severity: 'notice',
    title: 'robots.txt missing or unreachable',
    guidance:
      'Serve a robots.txt at the site root. Without one, crawlers assume everything is allowed and cannot discover your sitemap.',
    scope: 'site',
    check: (site) => (ok(site.robotsTxt) ? [] : [{ status: site.robotsTxt.status }]),
  },
  {
    id: 'robots-blocks-search-crawler',
    severity: 'error',
    title: 'robots.txt blocks a search engine',
    guidance:
      'Remove the Disallow rule that blocks the whole site for this crawler, or your pages will not appear in its search results.',
    scope: 'site',
    check: (site) =>
      crawlerAccess(robotsBody(site))
        .filter((c) => SEARCH_BOTS.has(c.bot) && c.verdict === 'blocked')
        .map((c) => ({ bot: c.bot, operator: c.operator })),
  },
  {
    id: 'robots-blocks-ai-crawler',
    severity: 'warning',
    title: 'robots.txt blocks an AI crawler',
    guidance:
      'Blocked AI crawlers cannot cite or recommend your site. Allow the bots you want visibility in; blocking training-only bots can be a deliberate choice.',
    scope: 'site',
    check: (site) =>
      crawlerAccess(robotsBody(site))
        .filter((c) => c.purpose !== 'search' && c.verdict === 'blocked')
        .map((c) => ({ bot: c.bot, operator: c.operator, purpose: c.purpose })),
  },
  {
    id: 'robots-no-sitemap',
    severity: 'notice',
    title: 'robots.txt does not list a sitemap',
    guidance: 'Add a line such as "Sitemap: https://example.com/sitemap.xml" to robots.txt.',
    scope: 'site',
    check: (site) => {
      const body = robotsBody(site)
      return body !== null && robotsSitemaps(body).length === 0 ? [{}] : []
    },
  },
  {
    id: 'sitemap-missing',
    severity: 'warning',
    title: 'sitemap.xml missing or unreachable',
    guidance: 'Publish a sitemap.xml listing your indexable pages so search engines find them.',
    scope: 'site',
    check: (site) => (ok(site.sitemapXml) ? [] : [{ status: site.sitemapXml.status }]),
  },
  {
    id: 'sitemap-invalid',
    severity: 'warning',
    title: 'sitemap.xml is not a valid sitemap',
    guidance: 'The file must be an XML <urlset> or <sitemapindex> with <loc> entries. Regenerate it.',
    scope: 'site',
    check: (site) => (ok(site.sitemapXml) && parseSitemap(site.sitemapXml.body).kind === 'invalid' ? [{}] : []),
  },
  {
    id: 'pages-missing-from-sitemap',
    severity: 'notice',
    title: 'Crawled pages missing from the sitemap',
    guidance: 'Add these indexable pages to sitemap.xml, or link them from pages that are listed.',
    scope: 'site',
    check: (site, pages) => {
      if (!ok(site.sitemapXml)) return []
      const sitemap = parseSitemap(site.sitemapXml.body)
      if (sitemap.kind !== 'urlset') return []
      const listed = new Set(sitemap.urls.map(normalizeUrl))
      const missing = pages
        .filter((p) => isOk(p) && !hasNoindex(p))
        .map((p) => p.url)
        .filter((url) => !listed.has(normalizeUrl(url)))
      return missing.length ? [{ count: missing.length, sample: missing.slice(0, MAX_SITEMAP_MISSING_SAMPLE) }] : []
    },
  },
  {
    id: 'llms-txt-missing',
    severity: 'notice',
    title: 'llms.txt missing',
    guidance:
      'Publish /llms.txt: a Markdown summary of your site with links to key pages, to help AI assistants use it accurately.',
    scope: 'site',
    check: (site) => (ok(site.llmsTxt) && site.llmsTxt.body.trim() !== '' ? [] : [{ status: site.llmsTxt.status }]),
  },
  {
    id: 'llms-txt-invalid',
    severity: 'warning',
    title: 'llms.txt is invalid',
    guidance:
      'Follow llmstxt.org: an H1 title, an optional blockquote summary, then H2 sections with "- [name](url): notes" lists.',
    scope: 'site',
    check: (site) => {
      if (!ok(site.llmsTxt) || site.llmsTxt.body.trim() === '') return []
      const result = validateLlmsTxt(site.llmsTxt.body)
      return result.valid ? [] : [{ problems: result.problems }]
    },
  },
]

export const AUDIT_RULES: AuditRule[] = [...PAGE_RULES, ...SITE_RULES].map(
  ({ id, severity, title, guidance, scope }) => ({ id, severity, title, guidance, scope })
)

export function runPageRules(pages: PageFacts[]): AuditIssue[] {
  const byUrl = new Map<string, PageFacts>()
  for (const page of pages) byUrl.set(normalizeUrl(page.url), page)
  const ctx: PageContext = {
    pages,
    byUrl,
    titleGroups: groupBy(pages, (p) => p.title),
    descriptionGroups: groupBy(pages, (p) => p.metaDescription),
  }

  const issues: AuditIssue[] = []
  for (const page of pages) {
    const failed = page.statusCode >= 400
    // Redirects and error pages carry no content worth auditing.
    const skipContent = failed || page.statusCode >= 300
    for (const rule of PAGE_RULES) {
      if (skipContent && rule.id !== 'http-error') continue
      const details = rule.check(page, ctx)
      if (details) {
        issues.push({ ruleId: rule.id, severity: rule.severity, pageUrl: page.url, details })
      }
    }
  }
  return issues
}

export function runSiteRules(site: SiteFacts, pages: PageFacts[]): AuditIssue[] {
  const issues: AuditIssue[] = []
  for (const rule of SITE_RULES) {
    for (const details of rule.check(site, pages)) {
      issues.push({ ruleId: rule.id, severity: rule.severity, pageUrl: null, details })
    }
  }
  return issues
}
