import { expect, test } from '@playwright/test'
import { loginViaProgrammaticPage } from './helpers/auth'
import { createProjectViaApi, deleteProjectViaApi, setActiveProject } from './helpers/projects'
import { selectors } from './helpers/selectors'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

test.setTimeout(60_000)

// The Feedback tool's Settings tab (`/feedback?view=settings&section=...`) loads shared data once and reuses it
// when switching between its sections. Project-wide settings live on `/project/settings`.
test('feedback settings sections warm shared data and avoid repeated fetches on revisit', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const projectSlug = `e2e-feedback-settings-${Date.now()}`
  const created = await createProjectViaApi(page.request, { name: 'Feedback Settings Warm Cache', slug: projectSlug })
  const projectId = created.project.id
  await setActiveProject(page.request, projectId)

  try {
    const categoriesResponse = await page.request.get(`/api/projects/${projectSlug}/categories`)
    expect(categoriesResponse.ok()).toBeTruthy()
    const defaultCategories = (await categoriesResponse.json())?.data as Array<{ id: string; name: string }>
    expect(defaultCategories.length).toBeGreaterThan(0)

    const createFeedbackResponse = await page.request.post('/api/feedback', {
      data: {
        title: 'Warm cache feedback item',
        body: 'This feedback exists so the tab has content to render.',
        projectId,
        productId: created.product.id,
        categoryId: defaultCategories[0]!.id,
      },
    })
    expect(createFeedbackResponse.status()).toBe(201)

    const requestCounts = { categories: 0, statuses: 0, feedback: 0, github: 0, githubRepos: 0 }

    page.on('request', (request) => {
      if (request.method() !== 'GET') return
      const url = request.url()
      if (url.includes(`/api/projects/${projectSlug}/categories`)) requestCounts.categories += 1
      if (url.includes(`/api/projects/${projectSlug}/statuses`)) requestCounts.statuses += 1
      if (url.includes('/api/feedback?') && url.includes(`projectIds=${projectId}`)) requestCounts.feedback += 1
    })

    await page.route(`**/api/projects/${projectSlug}/github/repos`, async (route) => {
      requestCounts.githubRepos += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 1,
              fullName: 'octo/example',
              name: 'example',
              htmlUrl: 'https://github.com/octo/example',
              private: false,
            },
          ],
        }),
      })
    })

    await page.route(`**/api/projects/${projectSlug}/github`, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }

      requestCounts.github += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 'fake-github-integration',
            owner: 'octo',
            repo: 'example',
            repoFullName: 'octo/example',
            syncEnabled: true,
            autoCreateIssues: false,
            autoSyncStatus: true,
            hasAccessToken: true,
            updatedAt: new Date().toISOString(),
          },
        }),
      })
    })

    await page.goto('/feedback', { waitUntil: 'domcontentloaded', timeout: 180_000 })
    await page.locator(selectors.feedbackTabSettings).click()
    await expect(page).toHaveURL(/view=settings/)
    await expect(page.locator('[data-testid="feedback-settings"]')).toBeVisible()

    // The default ("Manage") section warms categories, statuses and the feedback list exactly once.
    await expect(page.getByText('Warm cache feedback item')).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => requestCounts.statuses, { timeout: 10_000 }).toBe(1)
    await expect.poll(() => requestCounts.categories, { timeout: 10_000 }).toBe(1)
    await expect.poll(() => requestCounts.feedback, { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
    expect(requestCounts.githubRepos).toBe(0)

    const manageTab = page.locator('[data-testid="feedback-settings-tab-defaults"]')
    const categoriesTab = page.locator('[data-testid="feedback-settings-tab-categories"]')
    const statusesTab = page.locator('[data-testid="feedback-settings-tab-statuses"]')
    const githubTab = page.locator('[data-testid="feedback-settings-tab-github"]')

    await categoriesTab.click()
    await expect(page).toHaveURL(/section=categories/)
    await expect(page.getByRole('heading', { name: 'Feedback Categories' })).toBeVisible()
    await expect(page.locator('[data-testid^="product-category-item-"]').first()).toBeVisible()

    const categoriesRequestsAfterOpen = requestCounts.categories
    await manageTab.click()
    await expect(page.getByText('Warm cache feedback item')).toBeVisible()
    await categoriesTab.click()
    await expect(page.locator('[data-testid^="product-category-item-"]').first()).toBeVisible()
    expect(requestCounts.categories).toBe(categoriesRequestsAfterOpen)

    await page.getByRole('button', { name: 'Add Category' }).click()
    await page.locator('#cat-name').fill('Shared Cache Category')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByText('Shared Cache Category')).toBeVisible()

    await statusesTab.click()
    await expect(page.getByRole('heading', { name: 'Feedback Statuses' })).toBeVisible()
    const statusesRequestsAfterOpen = requestCounts.statuses
    await manageTab.click()
    await statusesTab.click()
    await expect(page.getByRole('heading', { name: 'Feedback Statuses' })).toBeVisible()
    expect(requestCounts.statuses).toBe(statusesRequestsAfterOpen)

    // A category created in one section is visible to the Manage section's filter without a new page load.
    await manageTab.click()
    await expect(page.getByText('Warm cache feedback item')).toBeVisible()
    const categoryFilterOptions = await page
      .locator('[data-testid="product-feedback-category-filter"] option')
      .allTextContents()
    expect(categoryFilterOptions).toContain('Shared Cache Category')

    await githubTab.click()
    await expect(page.getByRole('heading', { name: 'GitHub Integration' })).toBeVisible()
    await expect(page.locator('[data-testid="github-connect"]')).toHaveText(/Connected/)
    await expect.poll(() => requestCounts.githubRepos, { timeout: 10_000 }).toBe(1)

    // Revisiting the GitHub section reuses the cached integration and repo list.
    const githubRequestsAfterOpen = requestCounts.github
    await manageTab.click()
    await githubTab.click()
    await expect(page.locator('[data-testid="github-connect"]')).toHaveText(/Connected/)
    expect(requestCounts.github).toBe(githubRequestsAfterOpen)
    expect(requestCounts.githubRepos).toBe(1)

    // The section lives in the URL and survives a reload.
    await categoriesTab.click()
    await expect(page).toHaveURL(/section=categories/)
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 180_000 })
    await expect(page.getByRole('heading', { name: 'Feedback Categories' })).toBeVisible()
  } finally {
    await page.unroute(`**/api/projects/${projectSlug}/github`).catch(() => {})
    await deleteProjectViaApi(page.request, projectSlug).catch(() => {})
  }
})
