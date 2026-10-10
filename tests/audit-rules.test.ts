import { describe, expect, it } from 'vitest'

import { extractPageFacts } from '~/server/services/marketing/audit/extract'
import { AUDIT_RULES, runPageRules, runSiteRules } from '~/server/services/marketing/audit/rules'
import { computeScore, summarizeIssues } from '~/server/services/marketing/audit/score'
import type { AuditIssue, PageFacts, SiteFacts } from '~/server/services/marketing/audit/types'

const ORIGIN = 'https://example.com'

function page(url: string, overrides: Partial<PageFacts> = {}): PageFacts {
  return {
    url,
    statusCode: 200,
    title: 'A perfectly fine page title',
    metaDescription: 'A meta description that is comfortably long enough to pass the minimum check.',
    canonical: url,
    robotsMeta: null,
    lang: 'en',
    h1: ['Heading'],
    ogTitle: 'T',
    ogDescription: 'D',
    ogImage: `${ORIGIN}/og.png`,
    twitterCard: 'summary',
    internalLinks: [],
    externalLinkCount: 0,
    images: [],
    jsonLdTypes: ['Organization'],
    jsonLdErrors: 0,
    wordCount: 500,
    ...overrides,
  }
}

const ids = (issues: AuditIssue[]) => issues.map((i) => i.ruleId)
const forRule = (issues: AuditIssue[], id: string) => issues.filter((i) => i.ruleId === id)

describe('AUDIT_RULES', () => {
  it('has unique ids and complete metadata', () => {
    const seen = new Set<string>()
    for (const rule of AUDIT_RULES) {
      expect(seen.has(rule.id)).toBe(false)
      seen.add(rule.id)
      expect(rule.title).not.toBe('')
      expect(rule.guidance).not.toBe('')
      expect(['error', 'warning', 'notice']).toContain(rule.severity)
      expect(['page', 'site']).toContain(rule.scope)
    }
  })

  it('every issue emitted references a known rule with matching severity', () => {
    const pages = [
      page(`${ORIGIN}/`, { title: null, metaDescription: null, h1: [], wordCount: 3 }),
      page(`${ORIGIN}/x`, { statusCode: 500 }),
    ]
    const site: SiteFacts = {
      origin: ORIGIN,
      robotsTxt: { status: 404, body: null },
      llmsTxt: { status: 404, body: null },
      sitemapXml: { status: 404, body: null },
    }
    const byId = new Map(AUDIT_RULES.map((r) => [r.id, r]))
    for (const issue of [...runPageRules(pages), ...runSiteRules(site, pages)]) {
      const rule = byId.get(issue.ruleId)
      expect(rule, issue.ruleId).toBeDefined()
      expect(rule?.severity).toBe(issue.severity)
      expect(rule?.scope === 'site').toBe(issue.pageUrl === null)
    }
  })
})

describe('runPageRules', () => {
  it('reports nothing for a healthy page', () => {
    expect(runPageRules([page(`${ORIGIN}/`)])).toEqual([])
  })

  it('reports http errors and skips content rules for them', () => {
    const issues = runPageRules([page(`${ORIGIN}/gone`, { statusCode: 404, title: null, wordCount: 0 })])
    expect(ids(issues)).toEqual(['http-error'])
    expect(issues[0]).toMatchObject({ severity: 'error', pageUrl: `${ORIGIN}/gone`, details: { statusCode: 404 } })
    expect(ids(runPageRules([page(`${ORIGIN}/boom`, { statusCode: 503 })]))).toEqual(['http-error'])
  })

  it('skips content rules for redirects', () => {
    expect(runPageRules([page(`${ORIGIN}/old`, { statusCode: 301, title: null })])).toEqual([])
  })

  it('checks title presence and length boundaries', () => {
    const run = (title: string | null) => ids(runPageRules([page(`${ORIGIN}/a`, { title })]))
    expect(run(null)).toEqual(['title-missing'])
    expect(run('x'.repeat(9))).toEqual(['title-too-short'])
    expect(run('x'.repeat(10))).toEqual([])
    expect(run('x'.repeat(60))).toEqual([])
    expect(run('x'.repeat(61))).toEqual(['title-too-long'])
    const issue = runPageRules([page(`${ORIGIN}/a`, { title: 'x'.repeat(74) })])[0]
    expect(issue.details).toEqual({ length: 74, max: 60 })
  })

  it('flags duplicate titles across pages, case-insensitively', () => {
    const issues = runPageRules([
      page(`${ORIGIN}/a`, { title: 'Same Title Here' }),
      page(`${ORIGIN}/b`, { title: 'same title here' }),
      page(`${ORIGIN}/c`, { title: 'Unique title here' }),
    ])
    const dups = forRule(issues, 'title-duplicate')
    expect(dups.map((i) => i.pageUrl)).toEqual([`${ORIGIN}/a`, `${ORIGIN}/b`])
    expect(dups[0].details).toMatchObject({ count: 2, otherPages: [`${ORIGIN}/b`] })
  })

  it('does not count error pages as duplicates', () => {
    const issues = runPageRules([
      page(`${ORIGIN}/a`, { title: 'Same Title Here' }),
      page(`${ORIGIN}/b`, { title: 'Same Title Here', statusCode: 404 }),
    ])
    expect(forRule(issues, 'title-duplicate')).toEqual([])
  })

  it('checks meta description presence, length and duplicates', () => {
    const run = (d: string | null) => ids(runPageRules([page(`${ORIGIN}/a`, { metaDescription: d })]))
    expect(run(null)).toEqual(['meta-description-missing'])
    expect(run('x'.repeat(49))).toEqual(['meta-description-too-short'])
    expect(run('x'.repeat(50))).toEqual([])
    expect(run('x'.repeat(160))).toEqual([])
    expect(run('x'.repeat(161))).toEqual(['meta-description-too-long'])

    const desc = 'A shared description that is long enough to pass the minimum length rule.'
    const issues = runPageRules([
      page(`${ORIGIN}/a`, { metaDescription: desc, title: 'Title number one' }),
      page(`${ORIGIN}/b`, { metaDescription: desc, title: 'Title number two' }),
    ])
    expect(forRule(issues, 'meta-description-duplicate')).toHaveLength(2)
  })

  it('checks h1 presence and multiplicity', () => {
    expect(ids(runPageRules([page(`${ORIGIN}/a`, { h1: [] })]))).toEqual(['h1-missing'])
    expect(ids(runPageRules([page(`${ORIGIN}/a`, { h1: [''] })]))).toEqual(['h1-missing'])
    const multi = runPageRules([page(`${ORIGIN}/a`, { h1: ['One', 'Two', 'Three'] })])
    expect(ids(multi)).toEqual(['h1-multiple'])
    expect(multi[0].details).toEqual({ count: 3 })
  })

  it('checks canonical presence and origin', () => {
    expect(ids(runPageRules([page(`${ORIGIN}/a`, { canonical: null })]))).toEqual(['canonical-missing'])
    const cross = runPageRules([page(`${ORIGIN}/a`, { canonical: 'https://other.com/a' })])
    expect(ids(cross)).toEqual(['canonical-cross-origin'])
    expect(cross[0].details).toEqual({ canonical: 'https://other.com/a' })
    // Same origin, different path is fine.
    expect(runPageRules([page(`${ORIGIN}/a?utm=1`, { canonical: `${ORIGIN}/a` })])).toEqual([])
  })

  it('detects noindex and none directives', () => {
    expect(ids(runPageRules([page(`${ORIGIN}/a`, { robotsMeta: 'noindex, follow' })]))).toEqual(['noindex'])
    expect(ids(runPageRules([page(`${ORIGIN}/a`, { robotsMeta: 'none' })]))).toEqual(['noindex'])
    expect(runPageRules([page(`${ORIGIN}/a`, { robotsMeta: 'index, nofollow' })])).toEqual([])
  })

  it('flags missing lang, Open Graph and Twitter tags', () => {
    const issues = runPageRules([
      page(`${ORIGIN}/a`, {
        lang: null,
        ogTitle: null,
        ogDescription: null,
        ogImage: null,
        twitterCard: null,
      }),
    ])
    expect(ids(issues).sort()).toEqual(
      ['lang-missing', 'og-description-missing', 'og-image-missing', 'og-title-missing', 'twitter-card-missing'].sort()
    )
    expect(issues.every((i) => i.severity === 'notice')).toBe(true)
  })

  it('reports images without alt once per page with a count', () => {
    const issues = runPageRules([
      page(`${ORIGIN}/a`, {
        images: [
          { src: '1', alt: null },
          { src: '2', alt: '' },
          { src: '3', alt: 'ok' },
          { src: '4', alt: null },
        ],
      }),
    ])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ ruleId: 'images-missing-alt', details: { count: 2, total: 4 } })
  })

  it('reports invalid JSON-LD', () => {
    const issues = runPageRules([page(`${ORIGIN}/a`, { jsonLdErrors: 2 })])
    expect(issues[0]).toMatchObject({ ruleId: 'json-ld-invalid', details: { count: 2 } })
  })

  it('wants structured data on the home page only', () => {
    const home = runPageRules([page(`${ORIGIN}/`, { jsonLdTypes: [] })])
    expect(ids(home)).toEqual(['structured-data-missing'])
    expect(home[0].severity).toBe('notice')
    expect(runPageRules([page(`${ORIGIN}/about`, { jsonLdTypes: [] })])).toEqual([])
    expect(runPageRules([page(`${ORIGIN}/?ref=x`, { jsonLdTypes: [] })])).toEqual([])
  })

  it('flags thin content below 200 words', () => {
    expect(ids(runPageRules([page(`${ORIGIN}/a`, { wordCount: 199 })]))).toEqual(['thin-content'])
    expect(runPageRules([page(`${ORIGIN}/a`, { wordCount: 200 })])).toEqual([])
  })

  it('reports broken internal links once per source page, listing up to 10', () => {
    const dead = Array.from({ length: 12 }, (_, i) => `${ORIGIN}/dead-${i}`)
    const pages = [
      page(`${ORIGIN}/`, {
        internalLinks: [...dead, `${ORIGIN}/alive`, `${ORIGIN}/uncrawled`, `${ORIGIN}/dead-0/`],
      }),
      page(`${ORIGIN}/alive`),
      ...dead.map((u, i) => page(u, { statusCode: i % 2 ? 500 : 404, title: `Dead page ${i} title` })),
    ]
    const broken = forRule(runPageRules(pages), 'broken-internal-links')
    expect(broken).toHaveLength(1)
    expect(broken[0].pageUrl).toBe(`${ORIGIN}/`)
    expect(broken[0].severity).toBe('error')
    const details = broken[0].details as { count: number; targets: { url: string; statusCode: number }[] }
    expect(details.count).toBe(12)
    expect(details.targets).toHaveLength(10)
    expect(details.targets[0]).toEqual({ url: `${ORIGIN}/dead-0`, statusCode: 404 })
  })

  it('works end to end with extracted facts', () => {
    const html = `<html><head><title>Hi</title></head><body><h1>A</h1><h1>B</h1><img src="x.png"><a href="/missing">m</a></body></html>`
    const home = extractPageFacts(`${ORIGIN}/`, 200, html)
    const missing = extractPageFacts(`${ORIGIN}/missing`, 404, '')
    const found = ids(runPageRules([home, missing]))
    expect(found).toEqual(
      expect.arrayContaining([
        'title-too-short',
        'meta-description-missing',
        'h1-multiple',
        'canonical-missing',
        'images-missing-alt',
        'structured-data-missing',
        'thin-content',
        'broken-internal-links',
        'http-error',
      ])
    )
  })
})

const GOOD_ROBOTS = 'User-agent: *\nDisallow:\n\nSitemap: https://example.com/sitemap.xml\n'
const GOOD_SITEMAP = `<urlset><url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/about</loc></url></urlset>`
const GOOD_LLMS = '# Example\n\n> Summary\n\n## Docs\n\n- [Home](https://example.com/): start\n'

function site(overrides: Partial<SiteFacts> = {}): SiteFacts {
  return {
    origin: ORIGIN,
    robotsTxt: { status: 200, body: GOOD_ROBOTS },
    llmsTxt: { status: 200, body: GOOD_LLMS },
    sitemapXml: { status: 200, body: GOOD_SITEMAP },
    ...overrides,
  }
}

const SITE_PAGES = [page(`${ORIGIN}/`), page(`${ORIGIN}/about`)]

describe('runSiteRules', () => {
  it('reports nothing for a healthy site', () => {
    expect(runSiteRules(site(), SITE_PAGES)).toEqual([])
  })

  it('reports robots.txt missing or unreachable as a notice', () => {
    for (const robotsTxt of [
      { status: 404, body: null },
      { status: null, body: null },
      { status: 503, body: 'x' },
    ]) {
      const issues = runSiteRules(site({ robotsTxt }), SITE_PAGES)
      expect(ids(issues)).toEqual(['robots-txt-missing'])
      expect(issues[0]).toMatchObject({ severity: 'notice', pageUrl: null })
    }
  })

  it('reports a search engine blocked from / as an error per bot', () => {
    const body =
      'User-agent: Googlebot\nDisallow: /\n\nUser-agent: Bingbot\nDisallow: /\nSitemap: https://example.com/s.xml'
    const issues = forRule(
      runSiteRules(site({ robotsTxt: { status: 200, body } }), SITE_PAGES),
      'robots-blocks-search-crawler'
    )
    expect(issues.map((i) => i.details.bot).sort()).toEqual(['Bingbot', 'Googlebot'])
    expect(issues.every((i) => i.severity === 'error')).toBe(true)
  })

  it('reports each blocked AI crawler as a warning with the bot in details', () => {
    const body =
      'User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /private\n\nSitemap: https://example.com/s.xml'
    const issues = runSiteRules(site({ robotsTxt: { status: 200, body } }), SITE_PAGES)
    const ai = forRule(issues, 'robots-blocks-ai-crawler')
    expect(ai.map((i) => i.details.bot).sort()).toEqual(['ClaudeBot', 'GPTBot'])
    expect(ai.every((i) => i.severity === 'warning')).toBe(true)
    expect(forRule(issues, 'robots-blocks-search-crawler')).toEqual([])
  })

  it('treats a blanket wildcard block as blocking search and AI bots', () => {
    const issues = runSiteRules(
      site({ robotsTxt: { status: 200, body: 'User-agent: *\nDisallow: /\nSitemap: https://example.com/s.xml' } }),
      SITE_PAGES
    )
    expect(forRule(issues, 'robots-blocks-search-crawler')).toHaveLength(2)
    expect(forRule(issues, 'robots-blocks-ai-crawler')).toHaveLength(12)
  })

  it('reports a robots.txt without a Sitemap line', () => {
    const issues = runSiteRules(site({ robotsTxt: { status: 200, body: 'User-agent: *\nDisallow:' } }), SITE_PAGES)
    expect(ids(issues)).toEqual(['robots-no-sitemap'])
  })

  it('reports a missing or invalid sitemap', () => {
    const missing = runSiteRules(site({ sitemapXml: { status: 404, body: null } }), SITE_PAGES)
    expect(ids(missing)).toEqual(['sitemap-missing'])
    expect(missing[0].severity).toBe('warning')
    const invalid = runSiteRules(site({ sitemapXml: { status: 200, body: '<html>nope</html>' } }), SITE_PAGES)
    expect(ids(invalid)).toEqual(['sitemap-invalid'])
  })

  it('reports crawled pages missing from the sitemap with a capped sample', () => {
    const extra = Array.from({ length: 25 }, (_, i) => page(`${ORIGIN}/p${i}`, { title: `Page number ${i}` }))
    const pages = [
      ...SITE_PAGES,
      ...extra,
      page(`${ORIGIN}/hidden`, { robotsMeta: 'noindex', title: 'Hidden page title' }),
      page(`${ORIGIN}/err`, { statusCode: 404 }),
    ]
    const issues = forRule(runSiteRules(site(), pages), 'pages-missing-from-sitemap')
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('notice')
    const details = issues[0].details as { count: number; sample: string[] }
    expect(details.count).toBe(25)
    expect(details.sample).toHaveLength(20)
  })

  it('matches sitemap URLs ignoring trailing slashes and fragments', () => {
    const sm = `<urlset><url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/about/</loc></url></urlset>`
    expect(runSiteRules(site({ sitemapXml: { status: 200, body: sm } }), SITE_PAGES)).toEqual([])
  })

  it('skips the consistency check for sitemap indexes', () => {
    const sm = `<sitemapindex><sitemap><loc>${ORIGIN}/s1.xml</loc></sitemap></sitemapindex>`
    expect(runSiteRules(site({ sitemapXml: { status: 200, body: sm } }), SITE_PAGES)).toEqual([])
  })

  it('reports llms.txt missing as a notice and invalid as a warning with problems', () => {
    const missing = runSiteRules(site({ llmsTxt: { status: 404, body: null } }), SITE_PAGES)
    expect(ids(missing)).toEqual(['llms-txt-missing'])
    expect(missing[0].severity).toBe('notice')

    const invalid = runSiteRules(site({ llmsTxt: { status: 200, body: 'no heading\n- [a](b)' } }), SITE_PAGES)
    expect(ids(invalid)).toEqual(['llms-txt-invalid'])
    expect(invalid[0].severity).toBe('warning')
    expect((invalid[0].details.problems as string[]).length).toBeGreaterThan(0)

    const empty = runSiteRules(site({ llmsTxt: { status: 200, body: '' } }), SITE_PAGES)
    expect(ids(empty)).toEqual(['llms-txt-missing'])
  })
})

describe('computeScore', () => {
  const issue = (severity: AuditIssue['severity'], pageUrl: string | null): AuditIssue => ({
    ruleId: 'r',
    severity,
    pageUrl,
    details: {},
  })

  it('is 100 with no issues, including zero pages', () => {
    expect(computeScore([], 10)).toBe(100)
    expect(computeScore([], 0)).toBe(100)
  })

  it('counts site-level issues once, weighted by severity', () => {
    expect(computeScore([issue('error', null)], 50)).toBe(90)
    expect(computeScore([issue('warning', null)], 50)).toBe(96)
    expect(computeScore([issue('notice', null)], 50)).toBe(99)
  })

  it('normalises page-level issues by page count', () => {
    const everyPageWarns = (n: number) =>
      computeScore(
        Array.from({ length: n }, (_, i) => issue('warning', `https://e.com/${i}`)),
        n
      )
    expect(everyPageWarns(5)).toBe(everyPageWarns(500))
    expect(everyPageWarns(5)).toBe(80)
  })

  it('does not punish a single bad page on a big site as much as on a tiny one', () => {
    const one = [issue('error', 'https://e.com/a')]
    expect(computeScore(one, 100)).toBeGreaterThan(computeScore(one, 2))
  })

  it('is an integer clamped to 0..100', () => {
    const many = Array.from({ length: 50 }, () => issue('error', null))
    expect(computeScore(many, 1)).toBe(0)
    const s = computeScore([issue('notice', 'https://e.com/a')], 7)
    expect(Number.isInteger(s)).toBe(true)
    expect(s).toBeGreaterThanOrEqual(0)
    expect(s).toBeLessThanOrEqual(100)
  })
})

describe('summarizeIssues', () => {
  it('counts per severity and per rule', () => {
    const mk = (ruleId: string, severity: AuditIssue['severity']): AuditIssue => ({
      ruleId,
      severity,
      pageUrl: null,
      details: {},
    })
    expect(summarizeIssues([mk('a', 'error'), mk('a', 'error'), mk('b', 'notice'), mk('c', 'warning')])).toEqual({
      bySeverity: { error: 2, warning: 1, notice: 1 },
      byRule: { a: 2, b: 1, c: 1 },
      total: 4,
    })
    expect(summarizeIssues([])).toEqual({
      bySeverity: { error: 0, warning: 0, notice: 0 },
      byRule: {},
      total: 0,
    })
  })
})
