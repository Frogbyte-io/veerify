import { authClient } from '~/lib/auth-client'

export default defineNuxtRouteMiddleware(async (to, _from) => {
  // Skip middleware on server-side during generation/build
  if (import.meta.server) {
    return
  }

  // On team subdomains, all routes are public. Redirect app routes to team root.
  const teamSubdomain = useState('teamSubdomain')
  if (teamSubdomain.value) {
    const appRoutes = ['/dashboard', '/settings', '/reports', '/feedback', '/help', '/products', '/login', '/signup', '/auth', '/onboarding', '/submissions', '/get-started']
    if (appRoutes.some((r) => to.path.startsWith(r))) {
      return navigateTo('/')
    }
    return
  }

  try {
    const { data: session } = await authClient.useSession(useFetch)

    // Protected routes that require authentication
    const protectedRoutes = ['/dashboard', '/settings', '/reports', '/feedback', '/help', '/products', '/onboarding', '/submissions']

    // Auth routes that should redirect to dashboard if user is already logged in
    const authRoutes = ['/login', '/signup', '/auth']

    // Token-based feedback edit page is public even though /feedback is a protected prefix
    const isFeedbackEditPage = /^\/feedback\/[^/]+\/edit$/.test(to.path)
    const isProtectedRoute = !isFeedbackEditPage && protectedRoutes.some((route) => to.path.startsWith(route))

    const isAuthRoute = authRoutes.some((route) => to.path.startsWith(route))

    if (isProtectedRoute && !session.value?.user) {
      return navigateTo('/login')
    }

    if (isAuthRoute && session.value?.user) {
      const redirect = to.query.redirect
      if (redirect && typeof redirect === 'string' && redirect.startsWith('/')) {
        return navigateTo(redirect)
      }
      return navigateTo('/dashboard')
    }
  } catch (error) {
    console.error('Auth middleware error:', error)
  }
})
