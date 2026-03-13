import { expect, test } from '@playwright/test'
import { loginViaProgrammaticPage } from './helpers/auth'
import { getActiveTeamViaApi } from './helpers/teams'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

test.setTimeout(60_000)

test('product settings tabs warm shared data and avoid repeated fetches on revisit', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const activeTeam = await getActiveTeamViaApi(page.request)
  const projectSlug = `e2e-product-tabs-${Date.now()}`
  const createProjectResponse = await page.request.post(`/api/teams/${activeTeam.id}/projects`, {
    data: {
      name: 'Product Tabs Warm Cache',
      slug: projectSlug,
      description: null,
      customDomain: null,
    },
  })
  expect(createProjectResponse.status()).toBe(201)

  const categoriesResponse = await page.request.get(`/api/projects/${projectSlug}/categories`)
  expect(categoriesResponse.ok()).toBeTruthy()
  const categoriesPayload = await categoriesResponse.json()
  const defaultCategories = categoriesPayload?.data as Array<{ id: string; name: string }>
  expect(defaultCategories.length).toBeGreaterThan(0)

  const projectPayload = await createProjectResponse.json()
  const projectId = projectPayload?.data?.id as string
  expect(projectId).toBeTruthy()

  const createFeedbackResponse = await page.request.post('/api/feedback', {
    data: {
      title: 'Warm cache feedback item',
      body: 'This feedback exists so the tab has content to render.',
      projectId,
      categoryId: defaultCategories[0].id,
    },
  })
  expect(createFeedbackResponse.status()).toBe(201)

  const requestCounts = {
    categories: 0,
    statuses: 0,
    feedback: 0,
    github: 0,
    githubRepos: 0,
  }

  page.on('request', (request) => {
    if (request.method() !== 'GET') return

    const url = request.url()
    if (url.includes(`/api/projects/${projectSlug}/categories`)) requestCounts.categories += 1
    if (url.includes(`/api/projects/${projectSlug}/statuses`)) requestCounts.statuses += 1
    if (url.includes('/api/feedback?') && url.includes(`projectId=${projectId}`)) requestCounts.feedback += 1
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

  await page.goto(`/products/${projectSlug}`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await expect(page).toHaveURL(new RegExp(`/products/${projectSlug}$`))
  await expect(page.getByRole('heading', { name: 'General Settings' })).toBeVisible()

  await expect.poll(() => requestCounts.statuses, { timeout: 10_000 }).toBe(1)
  await expect.poll(() => requestCounts.feedback, { timeout: 10_000 }).toBe(1)
  await expect.poll(() => requestCounts.github, { timeout: 10_000 }).toBe(1)
  expect(requestCounts.githubRepos).toBe(0)
  expect(requestCounts.categories).toBe(0)

  const categoriesTab = page.locator('[data-testid="product-settings-tab-categories"]')
  const generalTab = page.locator('[data-testid="product-settings-tab-general"]')
  const statusesTab = page.locator('[data-testid="product-settings-tab-statuses"]')
  const feedbackTab = page.locator('[data-testid="product-settings-tab-feedback"]')
  const githubTab = page.locator('[data-testid="product-settings-tab-github"]')

  await categoriesTab.click()
  await expect(page).toHaveURL(new RegExp(`/products/${projectSlug}#categories$`))
  await expect(page.getByText('Feedback Categories')).toBeVisible()
  await expect(page.locator('[data-testid^="product-category-item-"]').first()).toBeVisible()

  const categoriesRequestsAfterFirstOpen = requestCounts.categories
  await generalTab.click()
  await expect(page.getByRole('heading', { name: 'General Settings' })).toBeVisible()
  await categoriesTab.click()
  await expect(page.locator('[data-testid^="product-category-item-"]').first()).toBeVisible()
  expect(requestCounts.categories).toBe(categoriesRequestsAfterFirstOpen)

  await page.getByRole('button', { name: 'Add Category' }).click()
  await page.locator('#cat-name').fill('Shared Cache Category')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Shared Cache Category')).toBeVisible()

  await statusesTab.click()
  await expect(page.getByText('Feedback Statuses')).toBeVisible()

  const statusesRequestsAfterFirstOpen = requestCounts.statuses
  await generalTab.click()
  await expect(page.getByRole('heading', { name: 'General Settings' })).toBeVisible()
  await statusesTab.click()
  await expect(page.getByText('Feedback Statuses')).toBeVisible()
  expect(requestCounts.statuses).toBe(statusesRequestsAfterFirstOpen)

  await feedbackTab.click()
  await expect(page.getByText('Warm cache feedback item')).toBeVisible()

  const categoryFilterOptions = await page
    .locator('[data-testid="product-feedback-category-filter"] option')
    .allTextContents()
  expect(categoryFilterOptions).toContain('Shared Cache Category')

  const feedbackRequestsAfterFirstOpen = requestCounts.feedback
  await generalTab.click()
  await expect(page.getByRole('heading', { name: 'General Settings' })).toBeVisible()
  await feedbackTab.click()
  await expect(page.getByText('Warm cache feedback item')).toBeVisible()
  expect(requestCounts.feedback).toBe(feedbackRequestsAfterFirstOpen)

  await githubTab.click()
  await expect(page.getByText('GitHub Integration')).toBeVisible()
  await expect(page.locator('[data-testid="github-connect"]')).toHaveText(/Connected/)
  await expect.poll(() => requestCounts.githubRepos, { timeout: 10_000 }).toBe(1)

  await page.goto(`/products/${projectSlug}#categories`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await expect(page).toHaveURL(new RegExp(`/products/${projectSlug}#categories$`))
  await expect(page.getByText('Feedback Categories')).toBeVisible()
})
