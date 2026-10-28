import { getHeader, type H3Event } from 'h3'
import { findPublicProjectByDomain } from '~/server/utils/project-access'

export function normalizeHostname(value: string) {
  return value.trim().toLowerCase().replace(/\.$/, '')
}

export function appDomains() {
  const appDomain = normalizeHostname(process.env.APP_DOMAIN || 'localhost')
  const dashboardDomain = normalizeHostname(
    process.env.APP_DASHBOARD_DOMAIN || (appDomain === 'localhost' ? 'localhost' : `app.${appDomain}`)
  )
  return { appDomain, dashboardDomain }
}

/**
 * Classifies a Host header. Any host that is not the app itself may be a
 * project's custom domain; `subdomainOrgSlug` is the workspace it names when it
 * is a direct subdomain of the app domain (`<org>.<appDomain>`).
 */
export function classifyHost(
  host: string
): { kind: 'app' } | { kind: 'public'; hostname: string; subdomainOrgSlug: string | null } {
  const { appDomain, dashboardDomain } = appDomains()
  const hostname = normalizeHostname(host.split(':')[0] || '')

  if (hostname === appDomain || hostname === dashboardDomain) return { kind: 'app' }

  let subdomainOrgSlug: string | null = null
  if (hostname.endsWith('.' + appDomain)) {
    const subdomain = hostname.slice(0, -(appDomain.length + 1))
    if (subdomain && !subdomain.includes('.')) subdomainOrgSlug = subdomain
  }
  return { kind: 'public', hostname, subdomainOrgSlug }
}

export type PublicHost =
  | { kind: 'app' }
  /** A project's active custom domain: the project lives at the domain root */
  | { kind: 'custom-domain'; orgSlug: string; projectSlug: string }
  | { kind: 'subdomain'; orgSlug: string }
  | { kind: 'unknown' }

/** Resolves the request host to the app, a project's custom domain or a workspace subdomain. */
export async function resolvePublicHost(event: H3Event): Promise<PublicHost> {
  const classified = classifyHost(getHeader(event, 'host') || '')
  if (classified.kind === 'app') return classified

  const publicProject = await findPublicProjectByDomain(classified.hostname)
  if (publicProject?.organization.slug) {
    return {
      kind: 'custom-domain',
      orgSlug: publicProject.organization.slug,
      projectSlug: publicProject.project.slug,
    }
  }
  if (classified.subdomainOrgSlug) return { kind: 'subdomain', orgSlug: classified.subdomainOrgSlug }
  return { kind: 'unknown' }
}
