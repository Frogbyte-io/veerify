import { authClient } from '~/lib/auth-client'
import {
  clearDashboardBootstrapCache,
  fetchDashboardBootstrap,
  getCachedDashboardBootstrap,
} from '~/lib/dashboard-bootstrap-client'
import { resolvePostAuthRedirectTarget } from '~/lib/auth-redirect'
import {
  isProtectedRoute as isProtectedPath,
  legacyChangelogRedirect,
  legacySupportRedirect,
  legacyRoadmapRedirect,
  resolvePublicHostRedirect,
} from '~/lib/route-guard'

export default defineNuxtRouteMiddleware(async (to) => {
  // Skip middleware on server-side during generation/build
  if (import.meta.server) {
    return
  }

  // On workspace subdomains and custom domains, all routes are public. Redirect app
  // routes to the root. `/changelog` is deliberately not an app route: it is the
  // public changelog here (the dashboard one is `/dashboard/changelog`).
  // Public routing state (set by the subdomain plugin): workspace slug and/or project slug.
  const publicOrgSlug = useState('publicOrgSlug')
  const publicProjectSlug = useState('publicProjectSlug')
  if (publicOrgSlug.value || publicProjectSlug.value) {
    if (resolvePublicHostRedirect(to.path)) {
      return navigateTo('/')
    }
    return
  }

  // Old dashboard changelog links (the page now lives at /dashboard/changelog)
  const legacyChangelog = legacyChangelogRedirect(to.path, to.fullPath.slice(to.path.length))
  if (legacyChangelog) {
    return navigateTo(legacyChangelog, { replace: true })
  }

  // The Inbox used to live under /support
  const legacySupport = legacySupportRedirect(to.path, to.fullPath.slice(to.path.length))
  if (legacySupport) {
    return navigateTo(legacySupport, { replace: true })
  }

  // Bare /roadmap is only public on workspace/custom domains (handled above)
  const legacyRoadmap = legacyRoadmapRedirect(to.path, to.fullPath.slice(to.path.length))
  if (legacyRoadmap) {
    return navigateTo(legacyRoadmap, { replace: true })
  }

  // Auth routes that should redirect to dashboard if user is already logged in
  const authRoutes = ['/login', '/signup', '/auth']

  const isProtectedRoute = isProtectedPath(to.path)

  const isAuthRoute = authRoutes.some((route) => to.path === route || to.path.startsWith(`${route}/`))

  try {
    if (isProtectedRoute) {
      const cachedBootstrap = getCachedDashboardBootstrap()
      if (cachedBootstrap?.session?.user) {
        return
      }

      if (to.path.startsWith('/dashboard')) {
        const bootstrap = await fetchDashboardBootstrap()
        if (bootstrap?.session?.user) {
          return
        }
        clearDashboardBootstrapCache()
        return navigateTo('/login')
      }

      const { data: session } = await authClient.useSession(useFetch)
      if (!session.value?.user) {
        return navigateTo('/login')
      }
      return
    }

    if (isAuthRoute) {
      const { data: session } = await authClient.useSession(useFetch)
      if (!session.value?.user) return

      // Allow adding a new account without being redirected away
      if (to.query.addAccount === 'true') {
        return
      }
      const redirect = to.query.redirect
      if (redirect && typeof redirect === 'string') {
        const target = await resolvePostAuthRedirectTarget(redirect, '/dashboard')
        if (target.startsWith('http://') || target.startsWith('https://')) {
          return navigateTo(target, { external: true })
        }
        return navigateTo(target)
      }
      return navigateTo('/dashboard')
    }
  } catch (error) {
    if (isProtectedRoute) {
      clearDashboardBootstrapCache()
      return navigateTo('/login')
    }
    console.error('Auth middleware error:', error)
  }
})
