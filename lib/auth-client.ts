import { createAuthClient } from 'better-auth/vue' // make sure to import from better-auth/vue
import { organizationClient, twoFactorClient } from 'better-auth/client/plugins'

const configuredBaseURL = process.env.BETTER_AUTH_URL

export const authClient = createAuthClient({
  ...(configuredBaseURL ? { baseURL: configuredBaseURL } : {}),
  plugins: [organizationClient({ teams: { enabled: true } }), twoFactorClient()],
})

// Export commonly used methods for convenience
export const { signIn, signUp, signOut, useSession } = authClient
