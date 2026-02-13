import { authClient } from '~/lib/auth-client'

export default defineNuxtRouteMiddleware(async (to, _from) => {
  // Skip middleware on server-side during generation/build
  if (import.meta.server) {
    return
  }

  // On team subdomains, all routes are public. Redirect app routes to team root.
  const teamSubdomain = useState('teamSubdomain')
  if (teamSubdomain.value) {
    const appRoutes = ['/dashboard', '/settings', '/reports', '/feedback', '/help', '/products', '/login', '/signup', '/auth']
    if (appRoutes.some((r) => to.path.startsWith(r))) {
      return navigateTo('/')
    }
    return
  }

  try {
    const { data: session } = await authClient.useSession(useFetch)

    // Protected routes that require authentication
    const protectedRoutes = ['/dashboard', '/settings', '/reports', '/feedback', '/help', '/products']

    // Auth routes that should redirect to dashboard if user is already logged in
    const authRoutes = ['/login', '/signup', '/auth']

    const isProtectedRoute = protectedRoutes.some((route) => to.path.startsWith(route))

    const isAuthRoute = authRoutes.some((route) => to.path.startsWith(route))

    if (isProtectedRoute && !session.value?.user) {
      // Redirect to login page if trying to access protected route without being logged in
      return navigateTo('/login')
    }

    // If user is logged in and trying to access auth routes, redirect to dashboard
    if (isAuthRoute && session.value?.user) {
      return navigateTo('/dashboard')
    }
  } catch (error) {
    // If there's an error checking session, allow access but log the error
    console.error('Auth middleware error:', error)
  }
})
