import { getRequestURL, setResponseStatus } from 'h3'
import { parsePublicPath } from '~/lib/public-site-path'
import { renderMarkdown } from '~/server/utils/markdown'
import { siteOf } from '~/server/services/public-site/documents'
import { loadPagePost, loadPublicOrganization, loadPublicProjectContext } from '~/server/services/public-site/context'
import {
  buildPublicHeadTags,
  originOf,
  renderOrgLlmsTxt,
  renderPageMarkdown,
} from '~/server/services/public-site/render'
import { createLogger } from '~/server/utils/logger'

const log = createLogger('public-site-head')

const APP_DESCRIPTION =
  'Veerify: feedback boards with voting, public roadmaps, changelogs, a support inbox and marketing tools. ' +
  'Has an MCP server and a REST API for AI agents.'

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Replaces the SSR `<title>` (the public components only know the project name after mounting). */
function setTitle(head: string[], title: string) {
  const tag = `<title>${escapeHtml(title)}</title>`
  let replaced = false
  const next = head.map((chunk) =>
    chunk.replace(/<title>[\s\S]*?<\/title>/, () => {
      replaced = true
      return tag
    })
  )
  if (!replaced) next.push(tag)
  return next
}

/** Page content for clients without JavaScript. */
function noscript(markdown: string, origin: string | null) {
  // renderMarkdown marks every link external/nofollow; links within the site are neither
  const content = renderMarkdown(markdown).replace(
    /<a href="([^"]*)" target="_blank" rel="noopener noreferrer nofollow">/g,
    (tag, href: string) => (!origin || href.startsWith(origin) ? `<a href="${href}">` : tag)
  )
  return `<noscript><article>${content}</article></noscript>`
}

/**
 * Public boards load their data in the browser, so the SSR HTML is an empty
 * shell. For crawlers and AI agents that do not run JavaScript, this adds the
 * page's real title, description, canonical URL, Open Graph tags, JSON-LD and
 * a markdown alternate, plus the page content inside `<noscript>`.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', async (html, { event }) => {
    try {
      const site = siteOf(event)

      if (site.kind === 'app') {
        html.head.push(
          `<meta name="description" content="${escapeHtml(APP_DESCRIPTION)}">`,
          '<meta property="og:site_name" content="Veerify">',
          `<meta property="og:description" content="${escapeHtml(APP_DESCRIPTION)}">`,
          '<link rel="alternate" type="text/plain" title="llms.txt" href="/llms.txt">'
        )
        return
      }
      if (site.kind !== 'project' && site.kind !== 'org') return

      const pathname = getRequestURL(event).pathname
      const parsed = parsePublicPath(pathname, site.kind === 'project')
      const projectSlug = site.kind === 'project' ? site.projectSlug : parsed?.projectSlug
      if (!parsed) return

      // Workspace subdomain root: the list of public projects
      if (!projectSlug) {
        const org = await loadPublicOrganization(event, site.orgSlug)
        if (!org) return
        const description = `Public feedback boards, roadmaps and changelogs of ${org.organization.name}.`
        html.head = setTitle(html.head, org.organization.name)
        html.head.push(
          `<meta name="description" content="${escapeHtml(description)}">`,
          `<meta property="og:title" content="${escapeHtml(org.organization.name)}">`,
          `<meta property="og:description" content="${escapeHtml(description)}">`,
          '<link rel="alternate" type="text/markdown" title="Markdown version" href="/index.md">'
        )
        html.bodyAppend.push(noscript(renderOrgLlmsTxt(org.organization, org.projects), null))
        return
      }

      const context = await loadPublicProjectContext(event, site.orgSlug, projectSlug)
      if (!context) return
      const post = await loadPagePost(context.snapshot, parsed.page)
      if (parsed.page.kind === 'post' && !post) {
        // Unknown, hidden or private item: the board still renders, but the URL is a 404 to crawlers
        setResponseStatus(event, 404)
        html.head.push('<meta name="robots" content="noindex">')
        return
      }
      const head = buildPublicHeadTags(context.snapshot, context.urls, parsed.page, post)
      const markdown = renderPageMarkdown(context.snapshot, context.urls, parsed.page, post)
      if (!head || !markdown) return

      html.head = setTitle(html.head, head.title)
      html.head.push(...head.tags)

      html.bodyAppend.push(noscript(markdown, originOf(context.urls.base)))
    } catch (error) {
      // Discovery extras must never break the page itself
      log.warn('Could not add public page metadata:', error)
    }
  })
})
