import { expect, type Page } from '@playwright/test'
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
    (response) =>
      response.request().method() === 'POST' && response.url().includes('/api/auth/sign-in/email'),
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
