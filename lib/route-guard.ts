/**
 * Pure routing helpers for `middleware/auth.global.ts`, kept free of Nuxt
 * imports so they can be unit tested.
 */

/** Dashboard/app routes. On public hosts (workspace subdomains, custom domains) they redirect to the root. */
export const PUBLIC_HOST_APP_ROUTES = [
  '/dashboard',
  '/settings',
  '/reports',
  '/feedback',
  '/help',
  '/workspace',
  '/project',
  '/login',
  '/signup',
  '/auth',
  '/onboarding',
  '/submissions',
  '/get-started',
  '/inbox',
  '/marketing',
  '/device',
]

/** Routes that need a session on the app host. */
export const PROTECTED_ROUTES = [
  '/dashboard',
  '/settings',
  '/reports',
  '/feedback',
  '/help',
  '/workspace',
  '/project',
  '/onboarding',
  '/submissions',
  '/inbox',
  '/marketing',
]

export function matchesRoute(path: string, route: string) {
  return path === route || path.startsWith(`${route}/`)
}

export function isPublicHostAppRoute(path: string) {
  return PUBLIC_HOST_APP_ROUTES.some((route) => matchesRoute(path, route))
}

export function isProtectedRoute(path: string) {
  // Token-based feedback edit page is public even though /feedback is a protected prefix
  if (/^\/feedback\/[^/]+\/edit$/.test(path)) return false
  return PROTECTED_ROUTES.some((route) => matchesRoute(path, route))
}

/**
 * The dashboard changelog lives under `/dashboard/changelog` so the bare
 * `/changelog` path stays free for the public changelog of custom domains.
 * On the app host, old `/changelog...` links are forwarded.
 */
export function legacyChangelogRedirect(path: string, search = ''): string | null {
  if (!matchesRoute(path, '/changelog')) return null
  return `/dashboard${path}${search}`
}

/**
 * Likewise the dashboard roadmap lives at `/dashboard/roadmap` because bare
 * `/roadmap` is the public roadmap on custom domains. On the app host only,
 * a bare `/roadmap` is forwarded.
 */
export function legacyRoadmapRedirect(path: string, search = ''): string | null {
  if (!matchesRoute(path, '/roadmap')) return null
  return `/dashboard${path}${search}`
}

/**
 * The Inbox tool was called Support and lived under `/support`. Old links
 * (bookmarks, notification rows stored before the rename) are forwarded.
 */
export function legacySupportRedirect(path: string, search = ''): string | null {
  if (!matchesRoute(path, '/support')) return null
  return `/inbox${path.slice('/support'.length)}${search}`
}

/** Redirect target for a path on a public host, or null to render it. */
export function resolvePublicHostRedirect(path: string): string | null {
  return isPublicHostAppRoute(path) ? '/' : null
}
