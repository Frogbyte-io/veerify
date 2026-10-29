import { FEEDBACK_POST_SEGMENT, feedbackPostRef, publicPagePath, type PublicPage } from '~/lib/public-site-path'
import type { PublicChangelogItem, PublicFeedbackItem, PublicFeedbackPost, PublicProjectSnapshot } from './snapshot'

/**
 * Pure renderers for the machine-readable surfaces of the public sites and the
 * app: llms.txt (https://llmstxt.org), per-page markdown, sitemap.xml,
 * robots.txt and the SEO/Open Graph/JSON-LD head tags.
 */

const LIST_BODY_CHARS = 280
const OVERVIEW_FEEDBACK_LIMIT = 25
const OVERVIEW_CHANGELOG_LIMIT = 10

const TAG_LABELS: Record<string, string> = {
  feature_request: 'Feature request',
  bug_report: 'Bug report',
  improvement: 'Improvement',
  question: 'Question',
  other: 'Other',
}

/** Collapses whitespace so user text stays on one markdown line. */
function oneLine(text: string | null | undefined) {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/** Link text: one line, brackets escaped. */
function linkText(text: string) {
  return oneLine(text).replace(/([[\]])/g, '\\$1')
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function isoDate(date: Date | string | null | undefined) {
  if (!date) return null
  const d = typeof date === 'string' ? new Date(date) : date
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

/** Quotes multi-line user text as a blockquote so it cannot add headings to the document. */
function quote(text: string) {
  return text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n')
}

// -- Project ------------------------------------------------------------------

export type ProjectUrls = {
  /** Board URL of the project, no trailing slash */
  base: string
  /** Changelog RSS feed, when the changelog is on */
  rss: string | null
}

export function projectSummary(s: PublicProjectSnapshot) {
  if (s.project.description?.trim()) return oneLine(s.project.description)
  const tools = [
    s.modules.feedbackEnabled && 'feedback board',
    s.modules.roadmapEnabled && 'roadmap',
    s.modules.changelogEnabled && 'changelog',
  ].filter(Boolean) as string[]
  const list = tools.length > 1 ? `${tools.slice(0, -1).join(', ')} and ${tools.at(-1)}` : tools[0] || 'public site'
  return `Public ${list} for ${s.project.name}.`
}

function statusName(s: PublicProjectSnapshot, value: string) {
  return s.statuses.find((st) => st.value === value)?.name ?? value
}

function productBoardUrl(s: PublicProjectSnapshot, urls: ProjectUrls, productId: string) {
  // With a single product the UI hides the product layer: the board is the project root
  if (s.products.length <= 1) return urls.base
  const product = s.products.find((p) => p.id === productId)
  return product ? `${urls.base}/${product.slug}` : urls.base
}

/** Canonical URL of a feedback item's own page. */
export function postUrl(urls: ProjectUrls, item: { id: string; title: string }) {
  return `${urls.base}/${FEEDBACK_POST_SEGMENT}/${feedbackPostRef(item)}`
}

function productName(s: PublicProjectSnapshot, productId: string) {
  return s.products.find((p) => p.id === productId)?.name ?? null
}

function feedbackLine(s: PublicProjectSnapshot, urls: ProjectUrls, item: PublicFeedbackItem, withBody: boolean) {
  const facts = [
    plural(item.voteCount, 'vote'),
    statusName(s, item.status),
    item.tag ? TAG_LABELS[item.tag] : null,
    item.category,
    s.products.length > 1 ? productName(s, item.productId) : null,
    item.commentCount > 0 ? plural(item.commentCount, 'comment') : null,
  ].filter(Boolean)
  let line = `- [${linkText(item.title)}](${postUrl(urls, item)}): ${facts.join(' · ')}`
  if (withBody && item.body?.trim()) line += `\n  ${truncate(oneLine(item.body), LIST_BODY_CHARS)}`
  return line
}

function feedbackBlock(s: PublicProjectSnapshot, urls: ProjectUrls, item: PublicFeedbackItem) {
  const facts = [
    plural(item.voteCount, 'vote'),
    `Status: ${statusName(s, item.status)}`,
    item.tag ? `Type: ${TAG_LABELS[item.tag]}` : null,
    item.category ? `Category: ${item.category}` : null,
    s.products.length > 1 ? `Product: ${productName(s, item.productId)}` : null,
    `Submitted: ${isoDate(item.createdAt)}`,
    `URL: ${postUrl(urls, item)}`,
  ].filter(Boolean)
  const lines = [`### ${oneLine(item.title)}`, '', facts.join(' · ')]
  if (item.body?.trim()) lines.push('', quote(item.body))
  return lines.join('\n')
}

function changelogLine(urls: ProjectUrls, entry: PublicChangelogItem) {
  const date = isoDate(entry.publishedAt)
  const summary = oneLine(entry.summary) || truncate(oneLine(stripMarkdown(entry.body)), LIST_BODY_CHARS)
  const note = [date, summary].filter(Boolean).join(' — ')
  return `- [${linkText(entry.title)}](${urls.base}/changelog/${entry.slug})${note ? `: ${note}` : ''}`
}

function changelogBlock(s: PublicProjectSnapshot, urls: ProjectUrls, entry: PublicChangelogItem, level = '###') {
  const products = entry.productIds.map((id) => productName(s, id)).filter(Boolean)
  const facts = [
    entry.publishedAt ? `Published: ${isoDate(entry.publishedAt)}` : null,
    entry.labels.length ? `Labels: ${entry.labels.join(', ')}` : null,
    products.length ? `Products: ${products.join(', ')}` : null,
    `URL: ${urls.base}/changelog/${entry.slug}`,
  ].filter(Boolean)
  const lines = [`${level} ${oneLine(entry.title)}`, '', facts.join(' · ')]
  if (entry.summary?.trim()) lines.push('', `_${oneLine(entry.summary)}_`)
  if (entry.body.trim()) lines.push('', nestHeadings(entry.body.trim(), level.length))
  return lines.join('\n')
}

/** Shifts markdown headings (outside code fences) so the top one sits one level below `parentLevel`. */
export function nestHeadings(markdown: string, parentLevel: number) {
  const lines = markdown.split('\n')
  let inFence = false
  const levels: number[] = []
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    else if (!inFence) {
      const m = /^(#{1,6})\s/.exec(line)
      if (m) levels.push(m[1]!.length)
    }
  }
  if (!levels.length) return markdown
  const shift = Math.max(0, parentLevel + 1 - Math.min(...levels))
  if (!shift) return markdown
  inFence = false
  return lines
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence
        return line
      }
      if (inFence) return line
      return line.replace(/^(#{1,6})(?=\s)/, (hashes) => '#'.repeat(Math.min(6, hashes.length + shift)))
    })
    .join('\n')
}

/** Rough plain text of markdown, for one-line summaries. */
export function stripMarkdown(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>~]/g, '')
}

function pagesSection(s: PublicProjectSnapshot, urls: ProjectUrls) {
  const lines: string[] = []
  if (s.modules.feedbackEnabled) {
    lines.push(`- [Feedback board](${urls.base}): browse, vote on and submit ideas and bug reports`)
    if (s.products.length > 1) {
      for (const p of s.products) {
        const desc = oneLine(p.description)
        lines.push(
          `- [${linkText(p.name)}](${urls.base}/${p.slug}): feedback board for ${oneLine(p.name)}${desc ? ` — ${desc}` : ''}`
        )
      }
    }
  }
  if (s.modules.roadmapEnabled) lines.push(`- [Roadmap](${urls.base}/roadmap): what is planned, in progress and done`)
  if (s.modules.changelogEnabled) {
    lines.push(`- [Changelog](${urls.base}/changelog): release notes and product updates`)
    if (urls.rss) lines.push(`- [Changelog RSS feed](${urls.rss})`)
  }
  return lines
}

/** `/llms.txt` of a project: an index with the most relevant content inline. */
export function renderProjectLlmsTxt(s: PublicProjectSnapshot, urls: ProjectUrls) {
  const out = [`# ${oneLine(s.project.name)}`, '', `> ${projectSummary(s)}`, '']
  out.push(
    `${oneLine(s.project.name)} by ${oneLine(s.organization.name)} collects product feedback in the open. ` +
      'Anyone can read and vote on requests; the team publishes what is planned and what has shipped.',
    ''
  )

  const pages = pagesSection(s, urls)
  if (pages.length) out.push('## Pages', '', ...pages, '')

  if (s.modules.feedbackEnabled && s.feedback.length) {
    out.push('## Top requests', '')
    for (const item of s.feedback.slice(0, OVERVIEW_FEEDBACK_LIMIT)) out.push(feedbackLine(s, urls, item, false))
    out.push('')
  }

  if (s.modules.changelogEnabled && s.changelog.length) {
    out.push('## Recent updates', '')
    for (const entry of s.changelog.slice(0, OVERVIEW_CHANGELOG_LIMIT)) out.push(changelogLine(urls, entry))
    out.push('')
  }

  out.push(
    '## Optional',
    '',
    `- [Full content](${urls.base}/llms-full.txt): every public request, the roadmap and recent release notes as markdown`,
    `- [Sitemap](${originOf(urls.base)}/sitemap.xml)`,
    ''
  )
  return out.join('\n')
}

/** `/llms-full.txt` of a project: all public content in one markdown document. */
export function renderProjectLlmsFullTxt(s: PublicProjectSnapshot, urls: ProjectUrls) {
  const out = [`# ${oneLine(s.project.name)}`, '', `> ${projectSummary(s)}`, '']
  const pages = pagesSection(s, urls)
  if (pages.length) out.push('## Pages', '', ...pages, '')

  if (s.products.length > 1) {
    out.push('## Products', '')
    for (const p of s.products) {
      const desc = oneLine(p.description)
      out.push(`- **${oneLine(p.name)}**${desc ? `: ${desc}` : ''} (${urls.base}/${p.slug})`)
    }
    out.push('')
  }

  if (s.modules.roadmapEnabled) out.push(renderRoadmap(s, urls, '##'), '')
  else if (s.modules.feedbackEnabled && s.feedback.length) {
    out.push('## Feedback', '')
    for (const item of s.feedback) out.push(feedbackBlock(s, urls, item), '')
  }

  if (s.modules.changelogEnabled && s.changelog.length) {
    out.push('## Changelog', '')
    for (const entry of s.changelog) out.push(changelogBlock(s, urls, entry), '')
  }
  return out.join('\n')
}

function renderRoadmap(s: PublicProjectSnapshot, urls: ProjectUrls, level: '#' | '##') {
  const sub = `${level}#`
  const out = [`${level} Roadmap`, '', `Live roadmap: ${urls.base}/roadmap`, '']
  for (const status of s.statuses) {
    const items = s.feedback.filter((f) => f.status === status.value)
    if (!items.length) continue
    out.push(`${sub} ${oneLine(status.name)}`, '')
    if (status.description) out.push(oneLine(status.description), '')
    for (const item of items) out.push(feedbackLine(s, urls, item, true))
    out.push('')
  }
  if (!s.feedback.length) out.push('Nothing on the roadmap yet.', '')
  return out.join('\n').trimEnd()
}

/**
 * Markdown of one public page (served for `Accept: text/markdown` and inside
 * `<noscript>`). Null when the page does not exist (unknown product or entry,
 * or a tool that is off).
 */
export function renderPageMarkdown(
  s: PublicProjectSnapshot,
  urls: ProjectUrls,
  page: PublicPage,
  post: PublicFeedbackPost | null = null
): string | null {
  switch (page.kind) {
    case 'post':
      return post ? renderPostMarkdown(s, urls, post) : null
    case 'board': {
      if (!s.modules.feedbackEnabled) return renderProjectLlmsTxt(s, urls)
      const product = page.productSlug ? s.products.find((p) => p.slug === page.productSlug) : null
      if (page.productSlug && !product) return null
      const items = product ? s.feedback.filter((f) => f.productId === product.id) : s.feedback
      const title =
        product && s.products.length > 1 ? `${oneLine(product.name)} feedback` : `${oneLine(s.project.name)} feedback`
      const out = [`# ${title}`, '', `> ${product?.description ? oneLine(product.description) : projectSummary(s)}`, '']
      const pages = pagesSection(s, urls)
      if (pages.length) out.push('## Pages', '', ...pages, '')
      out.push('## Requests', '')
      if (items.length) for (const item of items) out.push(feedbackLine(s, urls, item, true))
      else out.push('No feedback yet.')
      out.push('')
      return out.join('\n')
    }
    case 'roadmap':
      if (!s.modules.roadmapEnabled) return null
      return `${renderRoadmap(s, urls, '#').replace(/^# Roadmap/, `# ${oneLine(s.project.name)} roadmap`)}\n`
    case 'changelog': {
      if (!s.modules.changelogEnabled) return null
      if (page.entrySlug) {
        const entry = s.changelog.find((e) => e.slug === page.entrySlug)
        return entry ? `${changelogBlock(s, urls, entry, '#')}\n` : null
      }
      const out = [
        `# ${oneLine(s.project.name)} changelog`,
        '',
        `> Release notes and product updates for ${oneLine(s.project.name)}.`,
        '',
      ]
      if (urls.rss) out.push(`RSS feed: ${urls.rss}`, '')
      if (s.changelog.length) for (const entry of s.changelog) out.push(changelogLine(urls, entry))
      else out.push('No updates published yet.')
      out.push('')
      return out.join('\n')
    }
    case 'testimonials':
      return renderProjectLlmsTxt(s, urls)
  }
}

/** A feedback item's own page: the request, its facts and the public discussion. */
export function renderPostMarkdown(s: PublicProjectSnapshot, urls: ProjectUrls, post: PublicFeedbackPost) {
  const product = s.products.length > 1 ? productName(s, post.productId) : null
  const facts = [
    plural(post.voteCount, 'vote'),
    `Status: ${statusName(s, post.status)}`,
    post.tag ? `Type: ${TAG_LABELS[post.tag]}` : null,
    post.category ? `Category: ${post.category}` : null,
    product ? `Product: ${product}` : null,
    `Submitted: ${isoDate(post.createdAt)}${post.authorName ? ` by ${oneLine(post.authorName)}` : ''}`,
  ].filter(Boolean)
  const out = [
    `# ${oneLine(post.title)}`,
    '',
    `Feedback for ${oneLine(s.project.name)} · ${facts.join(' · ')}`,
    '',
    `URL: ${postUrl(urls, post)}`,
    `Board: ${productBoardUrl(s, urls, post.productId)}`,
    '',
  ]
  if (post.body?.trim()) out.push(quote(post.body), '')
  out.push(`## Comments (${post.comments.length})`, '')
  if (!post.comments.length) out.push('No comments yet.', '')
  for (const comment of post.comments) {
    out.push(
      `**${oneLine(comment.authorName)}**${comment.isReply ? ' (reply)' : ''} · ${isoDate(comment.createdAt)}`,
      '',
      quote(comment.body),
      ''
    )
  }
  return out.join('\n')
}

/** Absolute URLs of every public page of a project, for the sitemap. */
export function projectSitemapEntries(s: PublicProjectSnapshot, urls: ProjectUrls): SitemapEntry[] {
  const latestFeedback = s.feedback.reduce<Date | null>(
    (latest, f) => (!latest || f.createdAt > latest ? f.createdAt : latest),
    null
  )
  const entries: SitemapEntry[] = []
  if (s.modules.feedbackEnabled) {
    entries.push({ loc: urls.base, lastmod: latestFeedback, changefreq: 'daily', priority: 1 })
    if (s.products.length > 1) {
      for (const p of s.products) entries.push({ loc: `${urls.base}/${p.slug}`, changefreq: 'daily', priority: 0.8 })
    }
  }
  if (s.modules.feedbackEnabled || s.modules.roadmapEnabled) {
    for (const item of s.feedback) entries.push({ loc: postUrl(urls, item), lastmod: item.createdAt, priority: 0.6 })
  }
  if (s.modules.roadmapEnabled) {
    entries.push({ loc: `${urls.base}/roadmap`, lastmod: latestFeedback, changefreq: 'weekly', priority: 0.8 })
  }
  if (s.modules.changelogEnabled) {
    entries.push({
      loc: `${urls.base}/changelog`,
      lastmod: s.changelog[0]?.publishedAt ?? null,
      changefreq: 'weekly',
      priority: 0.8,
    })
    for (const entry of s.changelog) {
      entries.push({ loc: `${urls.base}/changelog/${entry.slug}`, lastmod: entry.publishedAt, priority: 0.6 })
    }
  }
  if (!entries.length) entries.push({ loc: urls.base, priority: 1 })
  entries.push({ loc: `${urls.base}/llms.txt`, priority: 0.3 })
  return entries
}

// -- Workspace (org subdomain root) ------------------------------------------

export type OrgProjectLink = { name: string; description: string | null; url: string }

export function renderOrgLlmsTxt(org: { name: string }, projects: OrgProjectLink[]) {
  const out = [
    `# ${oneLine(org.name)}`,
    '',
    `> Public feedback boards, roadmaps and changelogs of ${oneLine(org.name)}.`,
    '',
    '## Projects',
    '',
  ]
  if (projects.length) {
    for (const p of projects) {
      const desc = oneLine(p.description)
      out.push(`- [${linkText(p.name)}](${p.url}): ${desc || 'feedback board, roadmap and changelog'}`)
      out.push(`  - Details for agents: ${p.url}/llms.txt`)
    }
  } else {
    out.push('No public projects yet.')
  }
  out.push('')
  return out.join('\n')
}

// -- App (dashboard / API host) -----------------------------------------------

export function renderAppLlmsTxt(origin: string) {
  return [
    '# Veerify',
    '',
    '> Veerify is a feedback management platform: public feedback boards with voting, roadmaps and changelogs, a ' +
      'customer support inbox and marketing tools. Data is organised as workspaces → projects (brands) → products.',
    '',
    'Teams use Veerify to collect feature requests and bug reports from their users, let users vote, publish a ' +
      'roadmap of what is planned, and announce what shipped in a changelog. Each project gets a public site on a ' +
      'workspace subdomain or its own custom domain, and every public site has its own `/llms.txt`.',
    '',
    '## For AI agents',
    '',
    `- MCP server: \`POST ${origin}/mcp\` (stateless Streamable HTTP). Authenticate with a personal API key ` +
      "(Settings → API keys, `vfy_usr_...`) as `Authorization: Bearer <key>`. The agent acts with the key owner's " +
      'permissions. Tools: `whoami`, `list_workspaces`, `list_projects`, `set_context`, `search_api`, `call_api`.',
    `- Claude Code: \`claude mcp add --transport http veerify ${origin}/mcp --header "Authorization: Bearer vfy_usr_..."\``,
    '- REST API: the same personal key works as a Bearer token on the dashboard API under `/api/`. Send ' +
      '`X-Veerify-Organization` / `X-Veerify-Project` to pick the workspace and project per request.',
    '- In-app feedback: `POST /api/v1/feedback` with a project app key (Feedback settings → App keys) as a Bearer ' +
      "token creates feedback on that key's product.",
    '- Public data needs no key: `GET /api/public/o/{workspace}/{project}`, `.../roadmap`, `.../changelog` and ' +
      '`.../products/{product}/feedback`.',
    '',
    '## Docs',
    '',
    `- [API reference](${origin}/api-docs): interactive reference for every endpoint`,
    `- [OpenAPI specification](${origin}/api/openapi.json): machine-readable OpenAPI 3 document`,
    '',
    '## Optional',
    '',
    `- [Sign up](${origin}/signup): create a workspace`,
    `- [Sign in](${origin}/login)`,
    '',
  ].join('\n')
}

// -- sitemap.xml / robots.txt ---------------------------------------------------

export type SitemapEntry = {
  loc: string
  lastmod?: Date | null
  changefreq?: 'daily' | 'weekly' | 'monthly'
  priority?: number
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function renderSitemap(entries: SitemapEntry[]) {
  const urls = entries.map((e) => {
    const parts = [`    <loc>${xmlEscape(e.loc)}</loc>`]
    const lastmod = isoDate(e.lastmod)
    if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`)
    if (e.changefreq) parts.push(`    <changefreq>${e.changefreq}</changefreq>`)
    if (e.priority !== undefined) parts.push(`    <priority>${e.priority.toFixed(1)}</priority>`)
    return `  <url>\n${parts.join('\n')}\n  </url>`
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n')
}

/**
 * AI crawlers and assistants named explicitly so the welcome is unambiguous.
 * They get exactly the same rules as `*` (a named group replaces `*` for that bot).
 */
export const AI_USER_AGENTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'Amazonbot',
  'meta-externalagent',
  'DuckAssistBot',
  'MistralAI-User',
  'cohere-ai',
  'CCBot',
]

export function renderRobotsTxt(options: { allow: string[]; disallow: string[]; sitemap: string | null }) {
  const rules = [...options.allow.map((p) => `Allow: ${p}`), ...options.disallow.map((p) => `Disallow: ${p}`)]
  const lines = ['User-agent: *', ...rules, '', ...AI_USER_AGENTS.map((ua) => `User-agent: ${ua}`), ...rules, '']
  if (options.sitemap) lines.push(`Sitemap: ${options.sitemap}`, '')
  return lines.join('\n')
}

// -- <head> -------------------------------------------------------------------

export type HeadTags = { title: string; description: string; tags: string[] }

function attr(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** JSON for a `<script>` element: `<` escaped so content can never close the tag. */
function scriptJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

export function originOf(url: string) {
  return new URL(url).origin
}

/** Title, description, canonical, Open Graph, llms.txt/markdown alternates and JSON-LD of a public page. */
export function buildPublicHeadTags(
  s: PublicProjectSnapshot,
  urls: ProjectUrls,
  page: PublicPage,
  post: PublicFeedbackPost | null = null
): HeadTags | null {
  const name = oneLine(s.project.name)
  // A post's canonical URL carries its current title slug, whatever slug was requested
  const pageUrl = page.kind === 'post' && post ? postUrl(urls, post) : `${urls.base}${publicPagePath(page)}`
  const publisher = { '@type': 'Organization', name: oneLine(s.organization.name) }
  const website = { '@type': 'WebSite', name, url: urls.base, publisher }
  let title: string
  let description: string
  let jsonLd: Record<string, unknown>

  switch (page.kind) {
    case 'post': {
      if (!post) return null
      title = `${oneLine(post.title)} · ${name} feedback`
      description = truncate(
        oneLine(post.body) || `${statusName(s, post.status)} request with ${plural(post.voteCount, 'vote')}.`,
        300
      )
      jsonLd = {
        '@type': 'DiscussionForumPosting',
        headline: oneLine(post.title),
        text: post.body ?? undefined,
        url: pageUrl,
        mainEntityOfPage: pageUrl,
        datePublished: new Date(post.createdAt).toISOString(),
        author: { '@type': 'Person', name: oneLine(post.authorName) || 'Anonymous' },
        isPartOf: website,
        interactionStatistic: [
          {
            '@type': 'InteractionCounter',
            interactionType: 'https://schema.org/LikeAction',
            userInteractionCount: post.voteCount,
          },
          {
            '@type': 'InteractionCounter',
            interactionType: 'https://schema.org/CommentAction',
            userInteractionCount: post.comments.length,
          },
        ],
        comment: post.comments.map((c) => ({
          '@type': 'Comment',
          text: c.body,
          datePublished: new Date(c.createdAt).toISOString(),
          author: { '@type': 'Person', name: oneLine(c.authorName) },
        })),
      }
      break
    }
    case 'board': {
      const product = page.productSlug ? s.products.find((p) => p.slug === page.productSlug) : null
      if (page.productSlug && !product) return null
      title = product && s.products.length > 1 ? `${oneLine(product.name)} · ${name} feedback` : `${name} · Feedback`
      description = truncate(
        oneLine(product?.description) ||
          `${projectSummary(s)} Browse and vote on ${plural(s.feedback.length, 'public request')}.`,
        300
      )
      jsonLd = { '@type': 'CollectionPage', name: title, description, url: pageUrl, isPartOf: website }
      break
    }
    case 'roadmap':
      if (!s.modules.roadmapEnabled) return null
      title = `Roadmap · ${name}`
      description = `What ${name} has planned, is working on and has shipped.`
      jsonLd = { '@type': 'CollectionPage', name: title, description, url: pageUrl, isPartOf: website }
      break
    case 'changelog': {
      if (!s.modules.changelogEnabled) return null
      if (page.entrySlug) {
        const entry = s.changelog.find((e) => e.slug === page.entrySlug)
        if (!entry) return null
        title = `${oneLine(entry.title)} · ${name} changelog`
        description = truncate(oneLine(entry.summary) || oneLine(stripMarkdown(entry.body)) || title, 300)
        jsonLd = {
          '@type': 'BlogPosting',
          headline: oneLine(entry.title),
          description,
          url: pageUrl,
          mainEntityOfPage: pageUrl,
          datePublished: entry.publishedAt ? new Date(entry.publishedAt).toISOString() : undefined,
          keywords: entry.labels.length ? entry.labels.join(', ') : undefined,
          publisher,
          isPartOf: { '@type': 'Blog', name: `${name} changelog`, url: `${urls.base}/changelog` },
        }
      } else {
        title = `Changelog · ${name}`
        description = `Release notes and product updates for ${name}.`
        jsonLd = {
          '@type': 'Blog',
          name: `${name} changelog`,
          description,
          url: pageUrl,
          publisher,
          blogPost: s.changelog.slice(0, OVERVIEW_CHANGELOG_LIMIT).map((e) => ({
            '@type': 'BlogPosting',
            headline: oneLine(e.title),
            url: `${urls.base}/changelog/${e.slug}`,
            datePublished: e.publishedAt ? new Date(e.publishedAt).toISOString() : undefined,
          })),
        }
      }
      break
    }
    case 'testimonials':
      title = `Testimonials · ${name}`
      description = `What customers say about ${name}.`
      jsonLd = { '@type': 'WebPage', name: title, description, url: pageUrl, isPartOf: website }
      break
  }

  const tags = [
    `<meta name="description" content="${attr(description)}">`,
    `<link rel="canonical" href="${attr(pageUrl)}">`,
    `<meta property="og:type" content="${(page.kind === 'changelog' && page.entrySlug) || page.kind === 'post' ? 'article' : 'website'}">`,
    `<meta property="og:site_name" content="${attr(name)}">`,
    `<meta property="og:title" content="${attr(title)}">`,
    `<meta property="og:description" content="${attr(description)}">`,
    `<meta property="og:url" content="${attr(pageUrl)}">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${attr(title)}">`,
    `<meta name="twitter:description" content="${attr(description)}">`,
    `<link rel="alternate" type="text/markdown" title="Markdown version" href="${attr(markdownUrl(urls, page, post))}">`,
    `<script type="application/ld+json">${scriptJson({ '@context': 'https://schema.org', ...jsonLd })}</script>`,
  ]
  if (urls.rss) {
    tags.push(
      `<link rel="alternate" type="application/rss+xml" title="${attr(`${name} changelog`)}" href="${attr(urls.rss)}">`
    )
  }
  return { title, description, tags }
}

/**
 * Markdown twin of a page: the page URL plus `.md` (the board root is `/index.md`).
 * Served by the subdomain middleware, like `Accept: text/markdown` on the page itself.
 */
export function markdownUrl(urls: ProjectUrls, page: PublicPage, post: PublicFeedbackPost | null = null) {
  // A post links to its canonical slug, like the canonical URL
  const canonicalPage: PublicPage = page.kind === 'post' && post ? { kind: 'post', ref: feedbackPostRef(post) } : page
  const path = publicPagePath(canonicalPage)
  return `${urls.base}${path || '/index'}.md`
}
