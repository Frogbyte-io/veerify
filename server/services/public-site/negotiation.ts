import { getHeader, getRequestURL, setHeader, setResponseStatus, type H3Event } from 'h3'
import { markdownTwinPath, parsePublicPath } from '~/lib/public-site-path'
import { acceptsMarkdownOverHtml } from './accept'
import { loadPagePost, loadPublicOrganization, loadPublicProjectContext } from './context'
import { renderOrgLlmsTxt, renderPageMarkdown } from './render'

/**
 * Serves the markdown version of a public page for `<page>.md` URLs and for
 * `Accept: text/markdown`. Returns undefined when the request is not for one,
 * so normal rendering continues. Requires the public-site context set by the
 * subdomain middleware.
 */
export async function maybeSendPublicPageMarkdown(event: H3Event): Promise<string | undefined> {
  if (event.method !== 'GET' && event.method !== 'HEAD') return

  const requestPath = getRequestURL(event).pathname
  const twinPath = markdownTwinPath(requestPath)
  const negotiated = !twinPath && acceptsMarkdownOverHtml(getHeader(event, 'accept'))
  if (!twinPath && !negotiated) return
  // Files such as /robots.txt or /llms.txt have their own routes
  if (negotiated && /\.[a-z0-9]+$/i.test(requestPath)) return

  const orgSlug = event.context.publicOrgSlug as string | null
  const customDomainProject = event.context.publicProjectSlug as string | null
  if (!orgSlug) return

  const parsed = parsePublicPath(twinPath ?? requestPath, Boolean(customDomainProject))
  const projectSlug = customDomainProject || parsed?.projectSlug

  let markdown: string | null = null
  if (parsed && !projectSlug) {
    const org = await loadPublicOrganization(event, orgSlug)
    markdown = org ? renderOrgLlmsTxt(org.organization, org.projects) : null
  } else if (parsed && projectSlug) {
    const context = await loadPublicProjectContext(event, orgSlug, projectSlug)
    if (context) {
      const post = await loadPagePost(context.snapshot, parsed.page)
      markdown = renderPageMarkdown(context.snapshot, context.urls, parsed.page, post)
    }
  }

  setHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  setHeader(event, 'Vary', 'Accept')
  if (markdown === null) {
    setResponseStatus(event, 404)
    return '# Not found\n'
  }
  setHeader(event, 'Cache-Control', 'public, max-age=300')
  return markdown
}
