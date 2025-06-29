import { authClient } from "~/lib/auth-client";

export default defineNuxtRouteMiddleware(async (to, from) => {
  // Skip middleware on server-side during generation/build
  if (process.server) {
    return;
  }

  try {
    const { data: session } = await authClient.useSession(useFetch);
    
    // Protected routes that require authentication
    const protectedRoutes = ['/dashboard', '/settings', '/team', '/reports', '/feedback', '/help'];
    
    // Auth routes that should redirect to dashboard if user is already logged in
    const authRoutes = ['/login', '/signup', '/auth'];
    
    const isProtectedRoute = protectedRoutes.some(route => 
      to.path.startsWith(route)
    );
    
    const isAuthRoute = authRoutes.some(route => 
      to.path.startsWith(route)
    );
    
    if (isProtectedRoute && !session.value?.user) {
      // Redirect to login page if trying to access protected route without being logged in
      return navigateTo('/login');
    }
    
    // If user is logged in and trying to access auth routes, redirect to dashboard
    if (isAuthRoute && session.value?.user) {
      return navigateTo('/dashboard');
    }
  } catch (error) {
    // If there's an error checking session, allow access but log the error
    console.error('Auth middleware error:', error);
  }
}); 