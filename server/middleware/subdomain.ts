import { resolvePublicHost } from '~/server/utils/public-host'
import { maybeSendPublicPageMarkdown } from '~/server/services/public-site/negotiation'

function isPageRequest(pathname: string) {
  return (
    !pathname.startsWith('/api/') &&
    !pathname.startsWith('/_nuxt/') &&
    pathname !== '/favicon.ico' &&
    pathname !== '/mcp'
  )
}

export default defineEventHandler(async (event) => {
  event.context.publicOrgSlug = null
  event.context.publicProjectSlug = null

  const pathname = getRequestURL(event).pathname
  if (!isPageRequest(pathname)) {
    return
  }

  const host = await resolvePublicHost(event)
  if (host.kind === 'custom-domain') {
    event.context.publicOrgSlug = host.orgSlug
    event.context.publicProjectSlug = host.projectSlug
  } else if (host.kind === 'subdomain') {
    event.context.publicOrgSlug = host.orgSlug
  } else {
    return
  }

  // Agents get the page's content as markdown (`<page>.md`, or `Accept: text/markdown`)
  // instead of the client-rendered app shell.
  setHeader(event, 'Vary', 'Accept')
  return maybeSendPublicPageMarkdown(event)
})
