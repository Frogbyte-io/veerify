import { createAuthClient } from 'better-auth/vue' // make sure to import from better-auth/vue
import { organizationClient, twoFactorClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  // The base URL is optional if you're using the same domain
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
  plugins: [organizationClient(), twoFactorClient()],
})

// Export commonly used methods for convenience
export const { signIn, signUp, signOut, useSession } = authClient
