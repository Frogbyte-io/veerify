interface AppRedirectHostInput {
  redirectHost: string
  currentHost: string
  appDomain: string
  dashboardDomain: string
}

export function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '')
}

export function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  )
}

export function isAllowedRedirectProtocol(protocol: string, hostname: string): boolean {
  return protocol === 'https:' || (protocol === 'http:' && isLocalHostname(hostname))
}

export function isAppHostedRedirectHost(input: AppRedirectHostInput): boolean {
  const redirectHost = normalizeHostname(input.redirectHost)
  const currentHost = normalizeHostname(input.currentHost)
  const appDomain = normalizeHostname(input.appDomain)
  const dashboardDomain = normalizeHostname(input.dashboardDomain)

  return (
    redirectHost === currentHost ||
    redirectHost === appDomain ||
    redirectHost === dashboardDomain ||
    redirectHost.endsWith(`.${appDomain}`)
  )
}

export function parseRedirectUrl(rawRedirect: string): URL | null {
  try {
    const parsed = new URL(rawRedirect)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export async function resolveSafeRedirectTarget(rawRedirect: unknown, fallback = '/dashboard'): Promise<string> {
  if (!rawRedirect || typeof rawRedirect !== 'string') {
    return fallback
  }

  if (rawRedirect.startsWith('/')) {
    return rawRedirect
  }

  if (!import.meta.client) {
    return fallback
  }

  const parsed = parseRedirectUrl(rawRedirect)
  if (!parsed || parsed.username || parsed.password) {
    return fallback
  }

  const redirectHost = normalizeHostname(parsed.hostname)
  if (!isAllowedRedirectProtocol(parsed.protocol, redirectHost)) {
    return fallback
  }

  const config = useRuntimeConfig()
  const appDomain = normalizeHostname(String(config.public.appDomain || 'localhost'))
  const dashboardDomain = normalizeHostname(
    String(config.public.dashboardDomain || (appDomain === 'localhost' ? 'localhost' : `app.${appDomain}`))
  )
  const currentHost = normalizeHostname(window.location.hostname)

  if (
    isAppHostedRedirectHost({
      redirectHost,
      currentHost,
      appDomain,
      dashboardDomain,
    })
  ) {
    return parsed.toString()
  }

  try {
    const response = await $fetch<{ data?: { allowed?: boolean; target?: string | null } }>(
      '/api/public/auth/redirect-allowed',
      {
        query: { target: parsed.toString() },
      }
    )
    if (response?.data?.allowed === true && typeof response.data.target === 'string') {
      return response.data.target
    }
  } catch {
    // Ignore network errors and fall back to dashboard.
  }

  return fallback
}
