export default defineEventHandler((event) => {
  const host = getHeader(event, 'host') || ''
  const appDomain = process.env.APP_DOMAIN || 'localhost'
  const dashboardDomain =
    process.env.APP_DASHBOARD_DOMAIN || (appDomain === 'localhost' ? 'localhost' : `app.${appDomain}`)

  // Strip port from host
  const hostWithoutPort = host.split(':')[0]

  let teamSlug: string | null = null

  if (hostWithoutPort === appDomain || hostWithoutPort === dashboardDomain) {
    // Bare app domain — no subdomain
    teamSlug = null
  } else if (hostWithoutPort.endsWith('.' + appDomain)) {
    // e.g. "team.veerify.com" when APP_DOMAIN=veerify.com
    const subdomain = hostWithoutPort.slice(0, -(appDomain.length + 1))
    if (subdomain && !subdomain.includes('.')) {
      teamSlug = subdomain
    }
  } else if (appDomain === 'localhost' && hostWithoutPort.endsWith('.localhost')) {
    // Development: "team.localhost" — endsWith check handles the case above already,
    // but this explicit branch covers when APP_DOMAIN is left as default "localhost".
    const subdomain = hostWithoutPort.slice(0, -'.localhost'.length)
    if (subdomain && !subdomain.includes('.')) {
      teamSlug = subdomain
    }
  }

  event.context.teamSubdomain = teamSlug
})
