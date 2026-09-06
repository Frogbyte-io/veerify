import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { selectors } from './selectors'

export type LoginCredentials = {
  email: string
  password: string
}

async function gotoWithRetry(page: Page, path: string) {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      return
    } catch (error) {
      lastError = error
      if (attempt < 3) {
        await page.waitForTimeout(1000)
      }
    }
  }
  throw lastError
}

export function getPlaywrightBaseURL() {
  return process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${process.env.PLAYWRIGHT_PORT || 4173}`
}

export function withOriginHeaders(refererPath = '/') {
  const baseURL = getPlaywrightBaseURL()
  return {
    origin: baseURL,
    referer: `${baseURL}${refererPath}`,
  }
}

/**
 * Build request headers for authenticated API calls in tests that use the
 * raw cookie / withAuthHeaders pattern (API-only tests, no browser page).
 *
 * Pair with `signInAndGetSessionCookie` to get the cookie value.
 */
export function withAuthHeaders(sessionCookie: string, refererPath = '/feedback') {
  return {
    ...withOriginHeaders(refererPath),
    cookie: sessionCookie,
  }
}

/**
 * Sign in via the Better Auth API and return the raw session cookie string.
 * Use this in API-only tests that need to pass the cookie manually via `withAuthHeaders`.
 *
 * For browser-page tests use `loginViaProgrammaticPage` or `loginViaUi` instead.
 */
export async function signInAndGetSessionCookie(
  request: APIRequestContext,
  credentials: LoginCredentials
): Promise<string> {
  const signInResponse = await request.post('/api/auth/sign-in/email', {
    headers: {
      ...withOriginHeaders('/login'),
    },
    data: {
      email: credentials.email,
      password: credentials.password,
    },
  })

  const signInPayload = await signInResponse.json().catch(() => null)
  if (!signInResponse.ok()) {
    throw new Error(`Sign-in failed: ${JSON.stringify(signInPayload ?? {})}`)
  }

  const setCookie = signInResponse.headers()['set-cookie']
  if (!setCookie) throw new Error('Sign-in response missing Set-Cookie')
  return setCookie.split(';')[0]
}

/**
 * Sign in via the Better Auth API directly, without browser interaction.
 * The Playwright APIRequestContext automatically stores the returned session cookie,
 * so subsequent `request.*` calls in the same context will be authenticated.
 *
 * To also authenticate a browser page, transfer the cookies afterward:
 * ```ts
 * await loginViaProgrammatic(request, credentials)
 * const { cookies } = await request.storageState()
 * await page.context().addCookies(cookies.filter(c => c.name.startsWith('better-auth')))
 * ```
 *
 * For tests that need both API and page authentication, prefer `loginViaProgrammaticPage`.
 * Prefer this over `loginViaUi` for test setup where the login flow itself is not
 * what's being tested — it skips browser navigation and form interaction.
 */
export async function loginViaProgrammatic(request: APIRequestContext, credentials: LoginCredentials): Promise<void> {
  const response = await request.post('/api/auth/sign-in/email', {
    headers: withOriginHeaders('/login'),
    data: { email: credentials.email, password: credentials.password },
  })
  if (!response.ok()) {
    const body = await response.text().catch(() => '')
    throw new Error(`Programmatic login failed (${response.status()}): ${body}`)
  }
}

/**
 * Sign in via the Better Auth API using the browser page's own request context,
 * so the session cookie is automatically shared with the page — no manual cookie
 * transfer needed. Use this in page-based tests where the login UI itself is not
 * being tested.
 *
 * ```ts
 * await loginViaProgrammaticPage(page, credentials)
 * await page.goto('/dashboard') // already authenticated
 * ```
 */
export async function loginViaProgrammaticPage(page: Page, credentials: LoginCredentials): Promise<void> {
  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: withOriginHeaders('/login'),
    data: { email: credentials.email, password: credentials.password },
  })
  if (!response.ok()) {
    const body = await response.text().catch(() => '')
    throw new Error(`Programmatic login failed (${response.status()}): ${body}`)
  }
}

export async function expectRedirectToLogin(page: Page, protectedPath: string) {
  await gotoWithRetry(page, protectedPath)
  await expect(page).toHaveURL(/\/login/)
  await expect(page.locator(selectors.loginEmail)).toBeVisible()
}

export async function loginViaUi(page: Page, credentials: LoginCredentials) {
  await gotoWithRetry(page, '/login')
  await expect(page.locator(selectors.loginEmail)).toBeVisible()
  await page.waitForFunction(() => {
    const form = document.querySelector('form') as any
    return Boolean(form?.__vueParentComponent)
  })

  await page.locator(selectors.loginEmail).fill(credentials.email)
  await page.locator(selectors.loginPassword).fill(credentials.password)

  const signInResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/api/auth/sign-in/email'),
    { timeout: 20_000 }
  )

  await page.locator(selectors.loginSubmit).click()

  const signInResponse = await signInResponsePromise
  const responseText = await signInResponse.text().catch(() => '')
  if (!signInResponse.ok()) {
    throw new Error(`UI login request failed (${signInResponse.status()}): ${responseText || 'no response body'}`)
  }

  const navigatedToDashboard = await page
    .waitForURL(/\/dashboard/, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false)

  if (!navigatedToDashboard) {
    const loginError = page.locator(selectors.loginError)
    const errorText = await loginError
      .first()
      .isVisible()
      .then(async (visible) => (visible ? (await loginError.first().textContent()) || '' : ''))
      .catch(() => '')

    throw new Error(
      `UI login did not navigate to dashboard (status=${signInResponse.status()}).` +
        ` response=${responseText || 'none'}` +
        ` error=${errorText || 'none'}`
    )
  }

  await expect(page).toHaveURL(/\/dashboard/)
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}
