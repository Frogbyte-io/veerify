export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const appDomain = (config.public.appDomain as string) || 'localhost'
  const dashboardDomain = (config.public.dashboardDomain as string) || appDomain
  const host = window.location.hostname

  let orgSlug: string | null = null

  if (host === appDomain || host === dashboardDomain) {
    orgSlug = null
  } else if (host.endsWith('.' + appDomain)) {
    const subdomain = host.slice(0, -(appDomain.length + 1))
    if (subdomain && !subdomain.includes('.')) {
      orgSlug = subdomain
    }
  } else if (appDomain === 'localhost' && host.endsWith('.localhost')) {
    const subdomain = host.slice(0, -'.localhost'.length)
    if (subdomain && !subdomain.includes('.')) {
      orgSlug = subdomain
    }
  }

  const publicOrgSlugState = useState<string | null>('publicOrgSlug', () => null)
  if (!publicOrgSlugState.value && orgSlug) {
    publicOrgSlugState.value = orgSlug
  }

  useState<string | null>('publicProjectSlug', () => null)
})
