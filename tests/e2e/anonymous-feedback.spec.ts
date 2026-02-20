import { expect, test, type Page, type Locator } from '@playwright/test'
import { loginViaUi } from './helpers/auth'

/**
 * Anonymous feedback e2e tests.
 *
 * These tests exercise the public feedback page on the team subdomain:
 * http://{team}.localhost:{port}/{project}
 * which is seeded by the db:seed script. The anonymous session is managed
 * through an HttpOnly cookie `veerify_anon_session`.
 */

const PORT = Number(process.env.PLAYWRIGHT_PORT || 4173)
const TEAM_SLUG = process.env.E2E_TEAM_SLUG || 'preview-org'
const PROJECT_SLUG = process.env.E2E_PROJECT_SLUG || 'demo'
const PUBLIC_PAGE = process.env.E2E_PUBLIC_PAGE_URL || `http://${TEAM_SLUG}.localhost:${PORT}/${PROJECT_SLUG}`
const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

test.setTimeout(60_000)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForPageReady(page: Page) {
  // Wait for the public feedback page to load project data
  await page.waitForSelector('h1', { timeout: 30_000 })
}

async function gotoPublicPage(page: Page) {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(PUBLIC_PAGE, { waitUntil: 'domcontentloaded' })
      await waitForPageReady(page)
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

async function openSubmitDialog(page: Page) {
  const submitBtn = page.getByRole('button', { name: 'Submit Feedback' })
  await submitBtn.first().click()
  await expect(page.getByText('Share your ideas')).toBeVisible({ timeout: 5_000 })
}

async function fillAndSubmitFeedback(page: Page, opts: { title: string; body: string; name: string; email?: string }) {
  await openSubmitDialog(page)

  await page.locator('#fb-title').fill(opts.title)
  await page.locator('#fb-body').fill(opts.body)
  await page.locator('#fb-name').fill(opts.name)
  if (opts.email) {
    await page.locator('#fb-email').fill(opts.email)
  }

  // Click the submit button inside the dialog
  const dialogSubmit = page.locator('[role="dialog"] button', { hasText: 'Submit' }).last()
  await dialogSubmit.click()

  // Wait for the dialog to close and feedback list to reload
  await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 15_000 })
}

function getAnonCookie(page: Page) {
  return page
    .context()
    .cookies()
    .then((cookies) => cookies.find((c) => c.name === 'veerify_anon_session'))
}

async function setSwitchState(toggle: Locator, enabled: boolean) {
  await expect(toggle).toBeVisible()
  const isChecked = (await toggle.getAttribute('aria-checked')) === 'true'
  if (isChecked !== enabled) {
    await toggle.click()
  }
  await expect(toggle).toHaveAttribute('aria-checked', enabled ? 'true' : 'false')
}

async function sortFeedbackByNewest(page: Page) {
  const sortSelect = page.locator('select:has(option[value="createdAt"])').first()
  await expect(sortSelect).toBeVisible()
  await sortSelect.selectOption('createdAt')
}

async function signInOnPublicHost(page: Page, opts: { email: string; password: string }) {
  const result = await page.evaluate(
    async ({ email, password }) => {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const body = await response.text().catch(() => '')
      return { ok: response.ok, status: response.status, body }
    },
    { email: opts.email, password: opts.password }
  )

  expect(result.ok, `Public-host sign-in failed (${result.status}): ${result.body}`).toBe(true)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Anonymous feedback sessions', () => {
  test('public feedback page loads for unauthenticated users', async ({ page }) => {
    await gotoPublicPage(page)

    // Project header should render
    await expect(page.getByRole('heading', { name: 'Demo Project' })).toBeVisible()
    // Submit Feedback button should be visible
    await expect(page.getByRole('button', { name: 'Submit Feedback' }).first()).toBeVisible()
  })

  test('public board auth links include dashboard redirect target', async ({ page }) => {
    await gotoPublicPage(page)

    const loginLink = page.getByRole('link', { name: 'Log in' })
    const signupLink = page.getByRole('link', { name: 'Sign up' })

    const loginHref = await loginLink.getAttribute('href')
    const signupHref = await signupLink.getAttribute('href')

    expect(loginHref).toBeTruthy()
    expect(signupHref).toBeTruthy()
    expect(loginHref!).toContain('/login?redirect=')
    expect(signupHref!).toContain('/signup?redirect=')

    const loginUrl = new URL(loginHref!, PUBLIC_PAGE)
    const signupUrl = new URL(signupHref!, PUBLIC_PAGE)
    const loginRedirect = decodeURIComponent(loginUrl.searchParams.get('redirect') || '')
    const signupRedirect = decodeURIComponent(signupUrl.searchParams.get('redirect') || '')

    expect(loginRedirect).toContain(`/${PROJECT_SLUG}`)
    expect(signupRedirect).toContain(`/${PROJECT_SLUG}`)
  })

  test('category icon is shown on public feedback items when configured', async ({ page }) => {
    await gotoPublicPage(page)

    const categoryIcon = page.locator('[data-testid^="public-feedback-category-icon-"]').first()
    await expect(categoryIcon).toBeVisible()
    await expect(categoryIcon).not.toHaveText('')
  })

  test('anonymous user can submit feedback and gets a session cookie', async ({ page }) => {
    await gotoPublicPage(page)

    // No anonymous cookie before submission
    let cookie = await getAnonCookie(page)
    expect(cookie).toBeUndefined()

    const title = `Anon Feedback ${Date.now()}`
    await fillAndSubmitFeedback(page, {
      title,
      body: 'This is anonymous feedback submitted during e2e testing.',
      name: 'E2E Anon User',
    })

    // After submission, the anonymous session cookie should be set
    cookie = await getAnonCookie(page)
    expect(cookie).toBeDefined()
    expect(cookie!.httpOnly).toBe(true)
    expect(cookie!.path).toBe('/')

    // The submitted feedback should appear in the list
    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 })
  })

  test('anonymous user can submit feedback with optional email', async ({ page }) => {
    await gotoPublicPage(page)

    const title = `Anon With Email ${Date.now()}`
    await fillAndSubmitFeedback(page, {
      title,
      body: 'Feedback with optional email for notifications.',
      name: 'E2E Email User',
      email: 'anon@example.com',
    })

    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 })
  })

  test('anonymous user sees own submissions highlighted', async ({ page }) => {
    await gotoPublicPage(page)

    const title = `Own Submission ${Date.now()}`
    await fillAndSubmitFeedback(page, {
      title,
      body: 'Testing own submission highlighting.',
      name: 'Highlight User',
    })

    // The feedback card should have the "Your submission" badge
    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 })
    // Find the card containing our title and check for the highlight
    const card = page.locator('.space-y-3 > div', { hasText: title }).first()
    await expect(card.getByText('Your submission')).toBeVisible()
  })

  test('anonymous user can vote on feedback', async ({ page }) => {
    await gotoPublicPage(page)

    // First submit a feedback item to ensure there's something to vote on
    const title = `Votable Feedback ${Date.now()}`
    await fillAndSubmitFeedback(page, {
      title,
      body: 'Testing anonymous voting.',
      name: 'Vote Tester',
    })

    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 })

    // Click the vote button on the first feedback card
    const feedbackCard = page.locator('.space-y-3 > div', { hasText: title }).first()
    const voteButton = feedbackCard.locator('button').first()

    // Get initial vote count text
    const voteCountEl = voteButton.locator('span.text-sm.font-semibold').first()
    const initialCount = parseInt((await voteCountEl.textContent()) || '0', 10)

    expect(initialCount).toBeGreaterThan(0)

    // New submissions are auto-upvoted by the submitter, so first click removes the vote.
    await voteButton.click()
    await expect.poll(async () => parseInt((await voteCountEl.textContent()) || '0', 10)).toBe(initialCount - 1)

    // Second click adds the vote back.
    await voteButton.click()
    await expect.poll(async () => parseInt((await voteCountEl.textContent()) || '0', 10)).toBe(initialCount)
  })

  test('anonymous session cookie persists across page reloads', async ({ page }) => {
    await gotoPublicPage(page)

    // Submit feedback to create session
    const title = `Persist Test ${Date.now()}`
    await fillAndSubmitFeedback(page, {
      title,
      body: 'Testing session persistence.',
      name: 'Persist User',
    })

    // Get the cookie token
    const cookie1 = await getAnonCookie(page)
    expect(cookie1).toBeDefined()
    const token1 = cookie1!.value

    // Reload the page
    await page.reload()
    await waitForPageReady(page)

    // Cookie should still be present with the same token
    const cookie2 = await getAnonCookie(page)
    expect(cookie2).toBeDefined()
    expect(cookie2!.value).toBe(token1)

    // Ensure the newest submission is visible after reload.
    await sortFeedbackByNewest(page)
    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 })
  })

  test('anonymous session merges into authenticated user on login', async ({ page }) => {
    // Start as anonymous
    await gotoPublicPage(page)

    const title = `Merge Test ${Date.now()}`
    await fillAndSubmitFeedback(page, {
      title,
      body: 'Testing session merge on authentication.',
      name: 'Merge User',
    })

    // Verify anonymous cookie exists
    let cookie = await getAnonCookie(page)
    expect(cookie).toBeDefined()

    // Sign in on the same host so the anonymous cookie is available during merge.
    await signInOnPublicHost(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

    // Ensure merge has run on this host (login also triggers it, this call is idempotent).
    await page.evaluate(async () => {
      await fetch('/api/auth/merge-anonymous', { method: 'POST' })
    })

    await gotoPublicPage(page)

    // After merge, the anonymous cookie should be cleared
    cookie = await getAnonCookie(page)
    expect(cookie).toBeUndefined()

    // Feedback ownership should stay with the authenticated user.
    await sortFeedbackByNewest(page)
    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 })
    const card = page.locator('.space-y-3 > div', { hasText: title }).first()
    await expect(card.getByText('Your submission')).toBeVisible()
  })

  test('vote toggle works for anonymous users (vote then unvote)', async ({ page }) => {
    await gotoPublicPage(page)

    // Submit feedback
    const title = `Toggle Vote ${Date.now()}`
    await fillAndSubmitFeedback(page, {
      title,
      body: 'Testing vote toggle.',
      name: 'Toggle User',
    })

    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 })

    const feedbackCard = page.locator('.space-y-3 > div', { hasText: title }).first()
    const voteButton = feedbackCard.locator('button').first()
    const voteCountEl = voteButton.locator('span.text-sm.font-semibold').first()

    const initialCount = parseInt((await voteCountEl.textContent()) || '0', 10)

    expect(initialCount).toBeGreaterThan(0)

    // Newly submitted feedback is already voted by the submitter.
    // First click removes the vote.
    await voteButton.click()
    await expect.poll(async () => parseInt((await voteCountEl.textContent()) || '0', 10)).toBe(initialCount - 1)

    // Second click re-adds the vote.
    await voteButton.click()
    await expect.poll(async () => parseInt((await voteCountEl.textContent()) || '0', 10)).toBe(initialCount)
  })

  test('email helper text is shown in submit dialog', async ({ page }) => {
    await gotoPublicPage(page)

    await openSubmitDialog(page)

    // Check that the email helper text exists
    await expect(page.getByText('Provide your email to receive updates on comments and status changes.')).toBeVisible()
  })

  test('appearance footer toggles control public board footer visibility', async ({ page }) => {
    await loginViaUi(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
    await page.goto('/products/demo#appearance')
    await expect(page.getByRole('heading', { name: 'Board Appearance' })).toBeVisible()

    const poweredByToggle = page.locator('[data-testid="appearance-toggle-powered-by"]')
    const githubFooterToggle = page.locator('[data-testid="appearance-toggle-github-footer"]')
    const saveButton = page.getByRole('button', { name: 'Save Changes' })

    try {
      await setSwitchState(poweredByToggle, false)
      await setSwitchState(githubFooterToggle, false)

      const saveResponsePromise = page.waitForResponse(
        (response) => response.request().method() === 'PUT' && response.url().includes('/api/projects/demo'),
        { timeout: 20_000 }
      )
      await saveButton.click()
      const saveResponse = await saveResponsePromise
      expect(saveResponse.ok()).toBe(true)

      await gotoPublicPage(page)

      await expect(page.locator('[data-testid="public-footer-powered-by"]')).toHaveCount(0)
      await expect(page.locator('[data-testid="public-footer-github"]')).toHaveCount(0)
      await expect(page.locator('[data-testid="public-footer-veerify-board"]')).toHaveCount(0)
    } finally {
      // Reset settings via API to avoid cross-origin session cookie issues
      // when navigating back from the public board subdomain to the main app.
      // page.request shares the browser context's cookies across all domains,
      // bypassing SameSite restrictions that affect browser-level navigation.
      const resetResponse = await page.request.put(`http://127.0.0.1:${PORT}/api/projects/demo`, {
        data: { settings: null },
        headers: { 'content-type': 'application/json' },
      })
      expect(resetResponse.ok()).toBe(true)

      await gotoPublicPage(page)
      await expect(page.locator('[data-testid="public-footer-veerify-board"]')).toHaveCount(1)
    }
  })

  test('custom footer replaces default public board footer links', async ({ page }) => {
    await loginViaUi(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
    await page.goto('/products/demo#appearance')
    await expect(page.getByRole('heading', { name: 'Board Appearance' })).toBeVisible()

    const customFooterToggle = page.locator('[data-testid="appearance-toggle-custom-footer"]')
    const customFooterBranding = page.locator('[data-testid="appearance-custom-footer-branding"]')
    const customFooterText = page.locator('[data-testid="appearance-custom-footer-text"]')
    const customFooterPrimaryLabel = page.locator('[data-testid="appearance-custom-footer-primary-label"]')
    const customFooterPrimaryUrl = page.locator('[data-testid="appearance-custom-footer-primary-url"]')
    const customFooterSecondaryLabel = page.locator('[data-testid="appearance-custom-footer-secondary-label"]')
    const customFooterSecondaryUrl = page.locator('[data-testid="appearance-custom-footer-secondary-url"]')
    const saveButton = page.getByRole('button', { name: 'Save Changes' })

    try {
      await setSwitchState(customFooterToggle, true)
      await customFooterBranding.fill('Acme Labs')
      await customFooterText.fill('Product updates powered by Acme Labs.')
      await customFooterPrimaryLabel.fill('Acme Home')
      await customFooterPrimaryUrl.fill('https://acme.example')
      await customFooterSecondaryLabel.fill('Support')
      await customFooterSecondaryUrl.fill('https://acme.example/support')

      const saveResponsePromise = page.waitForResponse(
        (response) => response.request().method() === 'PUT' && response.url().includes('/api/projects/demo'),
        { timeout: 20_000 }
      )
      await saveButton.click()
      const saveResponse = await saveResponsePromise
      expect(saveResponse.ok()).toBe(true)

      await gotoPublicPage(page)

      await expect(page.locator('[data-testid="public-footer-custom"]')).toBeVisible()
      await expect(page.locator('[data-testid="public-footer-custom"]')).toContainText('Acme Labs')
      await expect(page.locator('[data-testid="public-footer-custom"]')).toContainText(
        'Product updates powered by Acme Labs.'
      )
      await expect(page.locator('[data-testid="public-footer-custom-link-0"]')).toHaveAttribute(
        'href',
        'https://acme.example'
      )
      await expect(page.locator('[data-testid="public-footer-custom-link-1"]')).toHaveAttribute(
        'href',
        'https://acme.example/support'
      )
      await expect(page.locator('[data-testid="public-footer-powered-by"]')).toHaveCount(0)
      await expect(page.locator('[data-testid="public-footer-github"]')).toHaveCount(0)
      await expect(page.locator('[data-testid="public-footer-veerify-board"]')).toHaveCount(0)
    } finally {
      // Reset settings via API to avoid cross-origin session cookie issues
      // when navigating back from the public board subdomain to the main app.
      const resetResponse = await page.request.put(`http://127.0.0.1:${PORT}/api/projects/demo`, {
        data: { settings: null },
        headers: { 'content-type': 'application/json' },
      })
      expect(resetResponse.ok()).toBe(true)
    }
  })

  test('product GitHub settings shows connect flow controls', async ({ page }) => {
    await loginViaUi(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
    await page.goto('/products/demo#github')
    await expect(page.getByRole('heading', { name: 'GitHub Integration' })).toBeVisible()

    await expect(page.locator('[data-testid="github-connect"]')).toBeVisible()
    await expect(page.locator('[data-testid="github-repo-select"]')).toBeVisible()
  })
})
