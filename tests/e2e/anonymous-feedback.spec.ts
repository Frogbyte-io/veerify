import { expect, test, type Page, type APIRequestContext } from '@playwright/test'
import { loginViaUi } from './helpers/auth'

/**
 * Anonymous feedback e2e tests.
 *
 * These tests exercise the public feedback page at /p/preview-org/demo
 * which is seeded by the db:seed script. The anonymous session is managed
 * through an HttpOnly cookie `veerify_anon_session`.
 */

const PUBLIC_PAGE = '/p/preview-org/demo'
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

async function openSubmitDialog(page: Page) {
  const submitBtn = page.getByRole('button', { name: 'Submit Feedback' })
  await submitBtn.first().click()
  await expect(page.getByText('Share your ideas')).toBeVisible({ timeout: 5_000 })
}

async function fillAndSubmitFeedback(
  page: Page,
  opts: { title: string; body: string; name: string; email?: string }
) {
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
  return page.context().cookies().then((cookies) => cookies.find((c) => c.name === 'veerify_anon_session'))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Anonymous feedback sessions', () => {
  test('public feedback page loads for unauthenticated users', async ({ page }) => {
    await page.goto(PUBLIC_PAGE)
    await waitForPageReady(page)

    // Project header should render
    await expect(page.getByRole('heading', { name: 'Demo Project' })).toBeVisible()
    // Submit Feedback button should be visible
    await expect(page.getByRole('button', { name: 'Submit Feedback' }).first()).toBeVisible()
  })

  test('anonymous user can submit feedback and gets a session cookie', async ({ page }) => {
    await page.goto(PUBLIC_PAGE)
    await waitForPageReady(page)

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
    await page.goto(PUBLIC_PAGE)
    await waitForPageReady(page)

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
    await page.goto(PUBLIC_PAGE)
    await waitForPageReady(page)

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
    await page.goto(PUBLIC_PAGE)
    await waitForPageReady(page)

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

    // Click to vote (upvote)
    await voteButton.click()
    await page.waitForTimeout(1000) // Wait for API response

    // Vote count should have increased
    const newCount = parseInt((await voteCountEl.textContent()) || '0', 10)
    expect(newCount).toBe(initialCount + 1)
  })

  test('anonymous session cookie persists across page reloads', async ({ page }) => {
    await page.goto(PUBLIC_PAGE)
    await waitForPageReady(page)

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

    // Own submissions should still be highlighted after reload
    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 })
  })

  test('anonymous session merges into authenticated user on login', async ({ page }) => {
    // Start as anonymous
    await page.goto(PUBLIC_PAGE)
    await waitForPageReady(page)

    const title = `Merge Test ${Date.now()}`
    await fillAndSubmitFeedback(page, {
      title,
      body: 'Testing session merge on authentication.',
      name: 'Merge User',
    })

    // Verify anonymous cookie exists
    let cookie = await getAnonCookie(page)
    expect(cookie).toBeDefined()

    // Now log in
    await loginViaUi(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

    // Trigger the merge
    await page.evaluate(async () => {
      await fetch('/api/auth/merge-anonymous', { method: 'POST' })
    })

    // After merge, the anonymous cookie should be cleared
    cookie = await getAnonCookie(page)
    expect(cookie).toBeUndefined()
  })

  test('vote toggle works for anonymous users (vote then unvote)', async ({ page }) => {
    await page.goto(PUBLIC_PAGE)
    await waitForPageReady(page)

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

    // Vote
    await voteButton.click()
    await page.waitForTimeout(1000)
    expect(parseInt((await voteCountEl.textContent()) || '0', 10)).toBe(initialCount + 1)

    // Unvote (toggle off)
    await voteButton.click()
    await page.waitForTimeout(1000)
    expect(parseInt((await voteCountEl.textContent()) || '0', 10)).toBe(initialCount)
  })

  test('email helper text is shown in submit dialog', async ({ page }) => {
    await page.goto(PUBLIC_PAGE)
    await waitForPageReady(page)

    await openSubmitDialog(page)

    // Check that the email helper text exists
    await expect(
      page.getByText('Provide your email to receive updates on comments and status changes.')
    ).toBeVisible()
  })
})
