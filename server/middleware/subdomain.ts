import { findPublicProjectByDomain } from '~/server/utils/project-access'

function normalizeHostname(value: string) {
  return value.trim().toLowerCase().replace(/\.$/, '')
}

function isPageRequest(pathname: string) {
  return !pathname.startsWith('/api/') && !pathname.startsWith('/_nuxt/') && pathname !== '/favicon.ico'
}

export default defineEventHandler(async (event) => {
  event.context.teamSubdomain = null
  event.context.publicProjectSlug = null

  const pathname = getRequestURL(event).pathname
  if (!isPageRequest(pathname)) {
    return
  }

  const host = getHeader(event, 'host') || ''
  const appDomain = normalizeHostname(process.env.APP_DOMAIN || 'localhost')
  const dashboardDomain = normalizeHostname(
    process.env.APP_DASHBOARD_DOMAIN || (appDomain === 'localhost' ? 'localhost' : `app.${appDomain}`)
  )
  const hostWithoutPort = normalizeHostname(host.split(':')[0] || '')

  if (hostWithoutPort === appDomain || hostWithoutPort === dashboardDomain) {
    return
  }

  const publicProject = await findPublicProjectByDomain(hostWithoutPort)
  if (publicProject) {
    event.context.teamSubdomain = publicProject.team.slug
    event.context.publicProjectSlug = publicProject.project.slug
    return
  }

  if (hostWithoutPort.endsWith('.' + appDomain)) {
    const subdomain = hostWithoutPort.slice(0, -(appDomain.length + 1))
    if (subdomain && !subdomain.includes('.')) {
      event.context.teamSubdomain = subdomain
      return
    }
  }

  if (appDomain === 'localhost' && hostWithoutPort.endsWith('.localhost')) {
    const subdomain = hostWithoutPort.slice(0, -'.localhost'.length)
    if (subdomain && !subdomain.includes('.')) {
      event.context.teamSubdomain = subdomain
      return
    }
  }
})
