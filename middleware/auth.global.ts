import { authClient } from '~/lib/auth-client'
import {
  clearDashboardBootstrapCache,
  fetchDashboardBootstrap,
  getCachedDashboardBootstrap,
} from '~/lib/dashboard-bootstrap-client'
import { resolvePostAuthRedirectTarget } from '~/lib/auth-redirect'

export default defineNuxtRouteMiddleware(async (to) => {
  // Skip middleware on server-side during generation/build
  if (import.meta.server) {
    return
  }

  // On team subdomains, all routes are public. Redirect app routes to team root.
  const teamSubdomain = useState('teamSubdomain')
  if (teamSubdomain.value) {
    const appRoutes = [
      '/dashboard',
      '/settings',
      '/reports',
      '/feedback',
      '/help',
      '/products',
      '/login',
      '/signup',
      '/auth',
      '/onboarding',
      '/submissions',
      '/get-started',
      '/support',
    ]
    if (appRoutes.some((r) => to.path.startsWith(r))) {
      return navigateTo('/')
    }
    return
  }

  // Protected routes that require authentication
  const protectedRoutes = [
    '/dashboard',
    '/settings',
    '/reports',
    '/feedback',
    '/help',
    '/products',
    '/onboarding',
    '/submissions',
    '/support',
  ]

  // Auth routes that should redirect to dashboard if user is already logged in
  const authRoutes = ['/login', '/signup', '/auth']

  // Token-based feedback edit page is public even though /feedback is a protected prefix
  const isFeedbackEditPage = /^\/feedback\/[^/]+\/edit$/.test(to.path)
  const isProtectedRoute = !isFeedbackEditPage && protectedRoutes.some((route) => to.path.startsWith(route))

  const isAuthRoute = authRoutes.some((route) => to.path.startsWith(route))

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
