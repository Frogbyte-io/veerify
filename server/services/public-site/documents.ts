import { createError, getHeader, setHeader, type H3Event } from 'h3'
import { classifyHost } from '~/server/utils/public-host'
import { loadPublicOrganization, loadPublicProjectContext, requestOrigin } from './context'
import {
  originOf,
  projectSitemapEntries,
  renderAppLlmsTxt,
  renderOrgLlmsTxt,
  renderProjectLlmsFullTxt,
  renderProjectLlmsTxt,
  renderRobotsTxt,
  renderSitemap,
  type SitemapEntry,
} from './render'

/** Workspace projects fully described in one subdomain-level document. */
const ORG_PROJECT_LIMIT = 25

/** Dashboard routes: private, not worth crawling. Mirrors middleware/auth.global.ts plus flows behind links. */
const APP_PRIVATE_PATHS = [
  '/api/',
  '/mcp',
  '/dashboard',
  '/settings',
  '/workspace',
  '/project',
  '/reports',
  '/feedback',
  '/help',
  '/inbox',
  '/marketing',
  '/onboarding',
  '/submissions',
  '/get-started',
  '/accept-invitation',
  '/auth',
  '/csat',
  '/testimonial',
]

type Site =
  | { kind: 'app' }
  | { kind: 'project'; orgSlug: string; projectSlug: string }
  | { kind: 'org'; orgSlug: string }
  | { kind: 'unknown' }

/** Which site a request is for, from the context the subdomain middleware sets. */
export function siteOf(event: H3Event): Site {
  const orgSlug = event.context.publicOrgSlug as string | null
  const projectSlug = event.context.publicProjectSlug as string | null
  if (orgSlug && projectSlug) return { kind: 'project', orgSlug, projectSlug }
  if (orgSlug) return { kind: 'org', orgSlug }
  return classifyHost(getHeader(event, 'host') || '').kind === 'app' ? { kind: 'app' } : { kind: 'unknown' }
}

function notFound(): never {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}

function sendText(event: H3Event, contentType: string, body: string) {
  setHeader(event, 'Content-Type', `${contentType}; charset=utf-8`)
  setHeader(event, 'Cache-Control', 'public, max-age=300')
  return body
}

export function robotsTxt(event: H3Event) {
  const origin = requestOrigin(event)
  const site = siteOf(event)
  const body =
    site.kind === 'app'
      ? renderRobotsTxt({
          allow: ['/', '/llms.txt', '/api-docs', '/api/openapi.json'],
          disallow: APP_PRIVATE_PATHS,
          sitemap: `${origin}/sitemap.xml`,
        })
      : renderRobotsTxt({
          // Public boards: everything, including the public JSON API and RSS feeds
          allow: ['/', '/api/public/o/'],
          disallow: ['/api/'],
          sitemap: site.kind === 'unknown' ? null : `${origin}/sitemap.xml`,
        })
  return sendText(event, 'text/plain', body)
}

export async function sitemapXml(event: H3Event) {
  const origin = requestOrigin(event)
  const site = siteOf(event)
  let entries: SitemapEntry[]

  if (site.kind === 'app') {
    entries = [
      { loc: `${origin}/`, priority: 1 },
      { loc: `${origin}/signup`, priority: 0.8 },
      { loc: `${origin}/api-docs`, priority: 0.8 },
      { loc: `${origin}/llms.txt`, priority: 0.5 },
    ]
  } else if (site.kind === 'project') {
    const context = await loadPublicProjectContext(event, site.orgSlug, site.projectSlug)
    if (!context) notFound()
    entries = projectSitemapEntries(context.snapshot, context.urls)
  } else if (site.kind === 'org') {
    const org = await loadPublicOrganization(event, site.orgSlug)
    if (!org) notFound()
    entries = [{ loc: `${origin}/`, priority: 0.5 }]
    // Projects on their own custom domain are listed in that domain's sitemap
    const here = org.projects.filter((p) => originOf(p.url) === origin).slice(0, ORG_PROJECT_LIMIT)
    for (const p of here) {
      const context = await loadPublicProjectContext(event, site.orgSlug, p.slug)
      if (context) entries.push(...projectSitemapEntries(context.snapshot, context.urls))
    }
  } else {
    notFound()
  }

  // A sitemap may only list URLs of its own host
  return sendText(event, 'application/xml', renderSitemap(entries.filter((e) => originOf(e.loc) === origin)))
}

/**
 * `/llms.txt` (or `/llms-full.txt` with `full`). On a workspace subdomain,
 * `projectSlug` selects `/<project>/llms.txt`; without it the workspace index is served.
 */
export async function llmsTxt(event: H3Event, options: { full: boolean; projectSlug?: string }) {
  const site = siteOf(event)

  if (options.projectSlug) {
    if (site.kind !== 'org') notFound()
    return projectLlms(event, site.orgSlug, options.projectSlug, options.full)
  }
  if (site.kind === 'app') return sendText(event, 'text/plain', renderAppLlmsTxt(requestOrigin(event)))
  if (site.kind === 'project') return projectLlms(event, site.orgSlug, site.projectSlug, options.full)
  if (site.kind === 'org') {
    const org = await loadPublicOrganization(event, site.orgSlug)
    if (!org) notFound()
    if (!options.full) return sendText(event, 'text/plain', renderOrgLlmsTxt(org.organization, org.projects))

    const parts: string[] = []
    for (const p of org.projects.slice(0, ORG_PROJECT_LIMIT)) {
      const context = await loadPublicProjectContext(event, site.orgSlug, p.slug)
      if (context) parts.push(renderProjectLlmsFullTxt(context.snapshot, context.urls))
    }
    return sendText(event, 'text/plain', parts.join('\n---\n\n') || renderOrgLlmsTxt(org.organization, []))
  }
  notFound()
}

async function projectLlms(event: H3Event, orgSlug: string, projectSlug: string, full: boolean) {
  const context = await loadPublicProjectContext(event, orgSlug, projectSlug)
  if (!context) notFound()
  const render = full ? renderProjectLlmsFullTxt : renderProjectLlmsTxt
  return sendText(event, 'text/plain', render(context.snapshot, context.urls))
}
