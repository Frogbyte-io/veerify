import { afterEach, describe, expect, it, vi } from 'vitest'

const SECURE_NAME = '__Secure-better-auth.session_token'
const PLAIN_NAME = 'better-auth.session_token'

async function resolveSessionCookieName(): Promise<string> {
  const { auth } = await import('../lib/auth')
  const context = await auth.$context
  return context.authCookies.sessionToken.name
}

describe('Better Auth secure-cookie configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('uses the secure session-cookie name consistently when the configured auth URL is HTTPS', async () => {
    vi.stubEnv('BETTER_AUTH_URL', 'https://dev.example.test')
    vi.stubEnv('BETTER_AUTH_SECRET', 'secure-cookie-test-secret-0123456789')
    vi.stubEnv('APP_DOMAIN', 'dev.example.test')

    await expect(resolveSessionCookieName()).resolves.toBe(SECURE_NAME)
  })

  it('keeps plain HTTP local development on the unprefixed cookie name', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000')
    vi.stubEnv('BETTER_AUTH_SECRET', 'secure-cookie-test-secret-0123456789')
    vi.stubEnv('APP_DOMAIN', 'localhost')

    await expect(resolveSessionCookieName()).resolves.toBe(PLAIN_NAME)
  })

  // Pinning `useSecureCookies` replaced a Better Auth default that fell back to
  // `NODE_ENV === 'production'`. Without this, a production deploy that left
  // BETTER_AUTH_URL unset or HTTP would silently downgrade to plain cookies.
  it('forces secure cookies in production even when the configured auth URL is not HTTPS', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BETTER_AUTH_URL', 'http://app.example.test')
    vi.stubEnv('BETTER_AUTH_SECRET', 'secure-cookie-test-secret-0123456789')
    vi.stubEnv('APP_DOMAIN', 'app.example.test')

    await expect(resolveSessionCookieName()).resolves.toBe(SECURE_NAME)
  })
})
