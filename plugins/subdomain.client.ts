export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const appDomain = (config.public.appDomain as string) || 'localhost'
  const dashboardDomain = (config.public.dashboardDomain as string) || appDomain
  const host = window.location.hostname

  let teamSlug: string | null = null

  if (host === appDomain || host === dashboardDomain) {
    teamSlug = null
  } else if (host.endsWith('.' + appDomain)) {
    const subdomain = host.slice(0, -(appDomain.length + 1))
    if (subdomain && !subdomain.includes('.')) {
      teamSlug = subdomain
    }
  } else if (appDomain === 'localhost' && host.endsWith('.localhost')) {
    const subdomain = host.slice(0, -'.localhost'.length)
    if (subdomain && !subdomain.includes('.')) {
      teamSlug = subdomain
    }
  }

  useState('teamSubdomain', () => teamSlug)
})
