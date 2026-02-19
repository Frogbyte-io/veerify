import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { selectors } from './helpers/selectors'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173'

test.setTimeout(60_000)

function withAuthHeaders(sessionCookie: string, refererPath = '/feedback') {
  return {
    cookie: sessionCookie,
    origin: BASE_URL,
    referer: `${BASE_URL}${refererPath}`,
  }
}

async function signInAndGetSessionCookie(request: APIRequestContext) {
  const signInResponse = await request.post('/api/auth/sign-in/email', {
    headers: {
      origin: BASE_URL,
      referer: `${BASE_URL}/login`,
    },
    data: {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    },
  })

  const signInPayload = await signInResponse.json().catch(() => null)
  expect(signInResponse.ok(), `Sign-in failed: ${JSON.stringify(signInPayload ?? {})}`).toBeTruthy()

  const setCookie = signInResponse.headers()['set-cookie']
  expect(setCookie, 'Sign-in response missing Set-Cookie').toBeTruthy()
  return setCookie!.split(';')[0]
}

async function getActiveTeamId(request: APIRequestContext, sessionCookie: string) {
  const response = await request.get('/api/teams/active', {
    headers: withAuthHeaders(sessionCookie),
  })
  const payload = await response.json()
  expect(response.ok()).toBeTruthy()
  expect(payload?.data?.id).toBeTruthy()
  return payload.data.id as string
}

async function createTestProject(request: APIRequestContext, sessionCookie: string, teamId: string, slug: string) {
  const response = await request.post(`/api/teams/${teamId}/projects`, {
    headers: withAuthHeaders(sessionCookie, '/products'),
    data: {
      name: `E2E Feedback ${slug}`,
      slug,
      description: 'Created by Playwright admin feedback test',
      customDomain: null,
    },
  })
  const payload = await response.json()
  expect(response.status(), `Create project failed: ${JSON.stringify(payload)}`).toBe(201)
  return payload.data.id as string
}

async function deleteTestProject(request: APIRequestContext, sessionCookie: string, teamId: string, projectId: string) {
  const response = await request.delete(`/api/teams/${teamId}/projects/${projectId}`, {
    headers: withAuthHeaders(sessionCookie),
  })
  expect(response.ok()).toBeTruthy()
}

test.describe('Admin feedback workflow', () => {
  test('API: create product, add feedback, delete feedback, delete product', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request)
    const teamId = await getActiveTeamId(request, sessionCookie)

    // Create test product
    const slug = `e2e-fb-api-${Date.now()}`
    const projectId = await createTestProject(request, sessionCookie, teamId, slug)

    // Create feedback
    const createFbRes = await request.post('/api/feedback', {
      headers: withAuthHeaders(sessionCookie),
      data: {
        projectId,
        title: 'API test feedback item',
        body: 'Created by Playwright API test for admin feedback workflow',
      },
    })
    expect(createFbRes.status()).toBe(201)
    const createFbPayload = await createFbRes.json()
    expect(createFbPayload?.success).toBeTruthy()
    const feedbackId = createFbPayload.data.id as string

    // Verify feedback appears in list
    const listRes = await request.get(`/api/feedback?projectId=${projectId}`, {
      headers: withAuthHeaders(sessionCookie),
    })
    const listPayload = await listRes.json()
    expect(listRes.ok()).toBeTruthy()
    expect(listPayload.data.items.some((i: any) => i.id === feedbackId)).toBeTruthy()

    // Delete feedback
    const deleteFbRes = await request.delete(`/api/feedback/${feedbackId}`, {
      headers: withAuthHeaders(sessionCookie),
    })
    expect(deleteFbRes.ok()).toBeTruthy()
    const deleteFbPayload = await deleteFbRes.json()
    expect(deleteFbPayload.data.deleted).toBeTruthy()

    // Verify feedback is gone
    const listAfterRes = await request.get(`/api/feedback?projectId=${projectId}`, {
      headers: withAuthHeaders(sessionCookie),
    })
    const listAfterPayload = await listAfterRes.json()
    expect(listAfterPayload.data.items.some((i: any) => i.id === feedbackId)).toBeFalsy()

    // Cleanup: delete the project
    await deleteTestProject(request, sessionCookie, teamId, projectId)
  })

  test('UI: feedback page loads, add and delete feedback', async ({ request, page }) => {
    const sessionCookie = await signInAndGetSessionCookie(request)

    // Transfer auth cookies to browser context
    const authCookies = (await request.storageState()).cookies.filter((cookie) =>
      cookie.name.startsWith('better-auth')
    )
    expect(authCookies.length).toBeGreaterThan(0)
    await page.context().addCookies(authCookies)

    // Create a test product via API for isolation
    const teamId = await getActiveTeamId(request, sessionCookie)
    const slug = `e2e-fb-ui-${Date.now()}`
    const projectId = await createTestProject(request, sessionCookie, teamId, slug)
    const setActiveTeamResponse = await page.request.post('/api/teams/active', {
      data: { teamId },
    })
    expect(setActiveTeamResponse.ok()).toBeTruthy()

    // Navigate to feedback page
    await page.goto('/feedback', { waitUntil: 'commit', timeout: 180_000 })
    await expect(page).toHaveURL(/\/feedback/)

    // Verify page title and Add Feedback button
    await expect(page.getByRole('heading', { name: 'Feedback' })).toBeVisible()
    await expect(page.locator(selectors.feedbackAddButton)).toBeVisible()

    // Wait for data to load (loading state should disappear)
    await expect(page.locator(selectors.feedbackLoading)).not.toBeVisible({ timeout: 30_000 })

    // If there's a project selector (multiple products), select our test project
    const projectSelector = page.locator(selectors.feedbackProjectSelector)
    if (await projectSelector.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await projectSelector.selectOption({ value: projectId })
      await page.waitForTimeout(2000)
    }

    await expect(page.locator(selectors.feedbackAddButton)).toBeEnabled({ timeout: 20_000 })

    // Click Add Feedback
    await page.locator(selectors.feedbackAddButton).click()

    // Fill in feedback form
    await expect(page.locator(selectors.feedbackCreateTitle)).toBeVisible({ timeout: 5_000 })
    await page.locator(selectors.feedbackCreateTitle).fill('UI Test Feedback Item')
    await page.locator(selectors.feedbackCreateBody).fill('This is test feedback created by Playwright E2E test')

    // Submit
    await page.locator(selectors.feedbackCreateSubmit).click()

    // Wait for dialog to close
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 15_000 })

    // Verify feedback appears in the list
    await expect(page.getByText('UI Test Feedback Item')).toBeVisible({ timeout: 10_000 })

    // Delete the feedback - find the item and click its delete button
    const feedbackItem = page.locator('[data-testid^="feedback-item-"]', { hasText: 'UI Test Feedback Item' }).first()
    const deleteBtn = feedbackItem.locator('button[data-testid^="feedback-item-delete-"]')
    await deleteBtn.click()

    // Confirm deletion
    await expect(page.locator(selectors.feedbackDeleteConfirm)).toBeVisible({ timeout: 5_000 })
    await page.locator(selectors.feedbackDeleteConfirm).click()

    // Wait for dialog to close and verify feedback is gone
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('UI Test Feedback Item')).not.toBeVisible({ timeout: 10_000 })

    // Cleanup: delete the test project via API
    await deleteTestProject(request, sessionCookie, teamId, projectId)
  })

  test('API: delete project cascades feedback', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request)
    const teamId = await getActiveTeamId(request, sessionCookie)

    // Create project
    const slug = `e2e-cascade-${Date.now()}`
    const projectId = await createTestProject(request, sessionCookie, teamId, slug)

    // Create feedback
    const createRes = await request.post('/api/feedback', {
      headers: withAuthHeaders(sessionCookie),
      data: {
        projectId,
        title: 'Will be cascaded',
        body: 'Testing cascade delete',
      },
    })
    expect(createRes.status()).toBe(201)

    // Delete project (should cascade feedback)
    await deleteTestProject(request, sessionCookie, teamId, projectId)

    // Verify feedback for that project returns empty
    const feedbackRes = await request.get(`/api/feedback?projectId=${projectId}`, {
      headers: withAuthHeaders(sessionCookie),
    })
    const payload = await feedbackRes.json()
    expect(payload.data.items.length).toBe(0)
  })

  test('API: delete nonexistent feedback returns 404', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request)

    const deleteRes = await request.delete('/api/feedback/nonexistent-id-12345', {
      headers: withAuthHeaders(sessionCookie),
    })
    expect(deleteRes.status()).toBe(404)
  })
})
