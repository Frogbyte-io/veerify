import { describe, expect, it } from 'vitest'
import { markdownTwinPath, parsePublicPath } from '~/lib/public-site-path'
import { acceptsMarkdownOverHtml } from '~/server/services/public-site/accept'
import {
  buildPublicHeadTags,
  markdownUrl,
  nestHeadings,
  projectSitemapEntries,
  renderPageMarkdown,
  renderProjectLlmsFullTxt,
  renderProjectLlmsTxt,
  renderRobotsTxt,
  renderSitemap,
} from '~/server/services/public-site/render'
import type { PublicProjectSnapshot } from '~/server/services/public-site/snapshot'

function snapshot(overrides: Partial<PublicProjectSnapshot> = {}): PublicProjectSnapshot {
  return {
    organization: { name: 'Acme Inc', slug: 'acme' },
    project: {
      id: 'p1',
      name: 'Rocket',
      slug: 'rocket',
      description: 'Rockets for everyone',
      customDomain: null,
      settings: null,
      updatedAt: new Date('2026-10-01'),
    },
    products: [
      { id: 'a', name: 'Booster', slug: 'booster', description: 'The first stage' },
      { id: 'b', name: 'Capsule', slug: 'capsule', description: null },
    ],
    modules: {
      feedbackEnabled: true,
      roadmapEnabled: true,
      changelogEnabled: true,
      supportEnabled: false,
      marketingEnabled: false,
    },
    statuses: [
      { value: 'open', name: 'Open', description: null },
      { value: 'planned', name: 'Planned', description: 'Coming soon' },
    ],
    feedback: [
      {
        id: 'f1',
        productId: 'a',
        title: 'Reusable [legs]',
        body: 'Land it\n# not a heading',
        status: 'planned',
        tag: 'feature_request',
        category: 'Hardware',
        voteCount: 42,
        commentCount: 3,
        createdAt: new Date('2026-09-01'),
      },
      {
        id: 'f2',
        productId: 'b',
        title: 'Bigger windows',
        body: null,
        status: 'open',
        tag: null,
        category: null,
        voteCount: 1,
        commentCount: 0,
        createdAt: new Date('2026-09-02'),
      },
    ],
    changelog: [
      {
        title: 'Launch day',
        slug: 'launch-day',
        summary: 'We flew',
        body: '## Details\n\nIt went up.',
        labels: ['new'],
        publishedAt: new Date('2026-10-20'),
        productIds: ['a'],
      },
    ],
    ...overrides,
  }
}

const urls = {
  base: 'https://acme.veerify.io/rocket',
  rss: 'https://acme.veerify.io/api/public/o/acme/rocket/changelog.rss',
}

describe('parsePublicPath', () => {
  it('parses workspace subdomain paths', () => {
    expect(parsePublicPath('/', false)).toEqual({ projectSlug: null, page: { kind: 'board', productSlug: null } })
    expect(parsePublicPath('/rocket', false)).toEqual({
      projectSlug: 'rocket',
      page: { kind: 'board', productSlug: null },
    })
    expect(parsePublicPath('/rocket/booster', false)?.page).toEqual({ kind: 'board', productSlug: 'booster' })
    expect(parsePublicPath('/rocket/roadmap', false)?.page).toEqual({ kind: 'roadmap' })
    expect(parsePublicPath('/rocket/changelog/launch-day', false)?.page).toEqual({
      kind: 'changelog',
      entrySlug: 'launch-day',
    })
    expect(parsePublicPath('/rocket/booster/extra', false)).toBeNull()
  })

  it('parses custom domain paths (no project segment)', () => {
    expect(parsePublicPath('/', true)).toEqual({ projectSlug: null, page: { kind: 'board', productSlug: null } })
    expect(parsePublicPath('/changelog', true)?.page).toEqual({ kind: 'changelog', entrySlug: null })
    expect(parsePublicPath('/booster', true)?.page).toEqual({ kind: 'board', productSlug: 'booster' })
  })
})

describe('markdownTwinPath', () => {
  it('maps .md URLs to their page', () => {
    expect(markdownTwinPath('/index.md')).toBe('/')
    expect(markdownTwinPath('/rocket/index.md')).toBe('/rocket')
    expect(markdownTwinPath('/rocket/roadmap.md')).toBe('/rocket/roadmap')
    expect(markdownTwinPath('/rocket/roadmap')).toBeNull()
  })

  it('round-trips with markdownUrl', () => {
    expect(markdownUrl(urls, { kind: 'board', productSlug: null })).toBe('https://acme.veerify.io/rocket/index.md')
    expect(markdownUrl({ base: 'https://feedback.acme.com', rss: null }, { kind: 'board', productSlug: null })).toBe(
      'https://feedback.acme.com/index.md'
    )
    expect(markdownUrl(urls, { kind: 'roadmap' })).toBe('https://acme.veerify.io/rocket/roadmap.md')
  })
})

describe('acceptsMarkdownOverHtml', () => {
  it('prefers markdown only when ranked at least as high as HTML', () => {
    expect(acceptsMarkdownOverHtml('text/markdown')).toBe(true)
    expect(acceptsMarkdownOverHtml('text/markdown, text/html;q=0.9')).toBe(true)
    expect(acceptsMarkdownOverHtml('text/html, text/markdown;q=0.5')).toBe(false)
    expect(acceptsMarkdownOverHtml('text/html,application/xhtml+xml,*/*;q=0.8')).toBe(false)
    expect(acceptsMarkdownOverHtml('*/*')).toBe(false)
    expect(acceptsMarkdownOverHtml(undefined)).toBe(false)
  })
})

describe('llms.txt', () => {
  it('indexes pages, top requests and recent updates', () => {
    const txt = renderProjectLlmsTxt(snapshot(), urls)
    expect(txt.startsWith('# Rocket\n\n> Rockets for everyone\n')).toBe(true)
    expect(txt).toContain('- [Roadmap](https://acme.veerify.io/rocket/roadmap)')
    expect(txt).toContain('- [Booster](https://acme.veerify.io/rocket/booster)')
    // Link text brackets are escaped; links go to the product board
    expect(txt).toContain('- [Reusable \\[legs\\]](https://acme.veerify.io/rocket/booster): 42 votes · Planned')
    expect(txt).toContain('- [Launch day](https://acme.veerify.io/rocket/changelog/launch-day): 2026-10-20 — We flew')
    expect(txt).toContain('https://acme.veerify.io/rocket/llms-full.txt')
  })

  it('leaves out tools that are off', () => {
    const s = snapshot()
    s.modules.roadmapEnabled = false
    s.modules.changelogEnabled = false
    const txt = renderProjectLlmsTxt(s, { ...urls, rss: null })
    expect(txt).not.toContain('/roadmap')
    expect(txt).not.toContain('changelog')
  })

  it('quotes user bodies in the full document so they cannot add headings', () => {
    const s = snapshot()
    s.modules.roadmapEnabled = false
    const full = renderProjectLlmsFullTxt(s, urls)
    expect(full).toContain('> # not a heading')
    expect(full).not.toMatch(/^# not a heading/m)
    // Entry body headings nest under the entry's own `###`
    expect(full).toContain('#### Details')
  })
})

describe('nestHeadings', () => {
  it('shifts headings below the parent and leaves code fences alone', () => {
    expect(nestHeadings('# A\n\n```\n# code\n```\n## B', 2)).toBe('### A\n\n```\n# code\n```\n#### B')
    expect(nestHeadings('#### Deep', 1)).toBe('#### Deep')
  })
})

describe('renderPageMarkdown', () => {
  it('renders a product board, the roadmap and a changelog entry', () => {
    const s = snapshot()
    const board = renderPageMarkdown(s, urls, { kind: 'board', productSlug: 'capsule' })!
    expect(board).toContain('# Capsule feedback')
    expect(board).toContain('Bigger windows')
    expect(board).not.toContain('Reusable')

    const roadmap = renderPageMarkdown(s, urls, { kind: 'roadmap' })!
    expect(roadmap).toMatch(/^# Rocket roadmap/)
    expect(roadmap.indexOf('## Open')).toBeLessThan(roadmap.indexOf('## Planned'))

    const entry = renderPageMarkdown(s, urls, { kind: 'changelog', entrySlug: 'launch-day' })!
    expect(entry).toMatch(/^# Launch day/)
    expect(entry).toContain('Products: Booster')
  })

  it('is null for pages that do not exist', () => {
    const s = snapshot()
    expect(renderPageMarkdown(s, urls, { kind: 'board', productSlug: 'nope' })).toBeNull()
    expect(renderPageMarkdown(s, urls, { kind: 'changelog', entrySlug: 'nope' })).toBeNull()
    s.modules.roadmapEnabled = false
    expect(renderPageMarkdown(s, urls, { kind: 'roadmap' })).toBeNull()
  })
})

describe('head tags', () => {
  it('escapes user text and keeps JSON-LD inside its script tag', () => {
    const s = snapshot()
    s.project.name = 'Rock"et </script><b>'
    const head = buildPublicHeadTags(s, urls, { kind: 'changelog', entrySlug: 'launch-day' })!
    const html = head.tags.join('\n')
    expect(html).toContain('<link rel="canonical" href="https://acme.veerify.io/rocket/changelog/launch-day">')
    expect(html).toContain('"@type":"BlogPosting"')
    expect(html).not.toContain('</script><b>')
    expect(html).toContain('Rock&quot;et &lt;/script&gt;')
    expect(html).toContain('href="https://acme.veerify.io/rocket/changelog/launch-day.md"')
  })
})

describe('sitemap and robots', () => {
  it('lists every public page', () => {
    const locs = projectSitemapEntries(snapshot(), urls).map((e) => e.loc)
    expect(locs).toEqual([
      'https://acme.veerify.io/rocket',
      'https://acme.veerify.io/rocket/booster',
      'https://acme.veerify.io/rocket/capsule',
      'https://acme.veerify.io/rocket/roadmap',
      'https://acme.veerify.io/rocket/changelog',
      'https://acme.veerify.io/rocket/changelog/launch-day',
      'https://acme.veerify.io/rocket/llms.txt',
    ])
    const xml = renderSitemap([{ loc: 'https://x.test/a?b=1&c=2', lastmod: new Date('2026-10-20T12:00:00Z') }])
    expect(xml).toContain('<loc>https://x.test/a?b=1&amp;c=2</loc>')
    expect(xml).toContain('<lastmod>2026-10-20</lastmod>')
  })

  it('gives named AI crawlers the same rules as everyone else', () => {
    const robots = renderRobotsTxt({ allow: ['/'], disallow: ['/api/'], sitemap: 'https://x.test/sitemap.xml' })
    expect(robots).toContain('User-agent: GPTBot\n')
    expect(robots).toContain('User-agent: ClaudeBot\n')
    expect(robots.match(/Disallow: \/api\//g)).toHaveLength(2)
    expect(robots.trimEnd().endsWith('Sitemap: https://x.test/sitemap.xml')).toBe(true)
  })
})
