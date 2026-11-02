import { expect, test } from '@playwright/test'
import { loginViaProgrammaticPage } from './helpers/auth'
import {
  createProjectViaApi,
  deleteProjectViaApi,
  ensureProjectContext,
  getActiveProjectViaApi,
  setActiveProject,
} from './helpers/projects'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

test.setTimeout(90_000)

test.describe('dashboard overview', () => {
  test('the overview API describes what needs attention and the last 7 days', async ({ page }) => {
    await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
    await ensureProjectContext(page.request)
    // A new session restores the last context, which may be All projects
    await setActiveProject(page.request, (await getActiveProjectViaApi(page.request)).id)

    const response = await page.request.get('/api/dashboard/overview')
    expect(response.ok()).toBeTruthy()
    const { data } = await response.json()

    expect(data.needsYou.slaAtRisk).toMatchObject({ total: expect.any(Number), items: expect.any(Array) })
    expect(data.needsYou.waiting).toMatchObject({ total: expect.any(Number), byProject: expect.any(Array) })
    expect(data.needsYou.untriaged).toMatchObject({ total: expect.any(Number) })
    expect(data.needsYou.drafts).toMatchObject({ total: expect.any(Number), items: expect.any(Array) })
    expect(Date.parse(data.week.to) - Date.parse(data.week.from)).toBe(7 * 86_400_000)
    expect(Date.parse(data.week.from) - Date.parse(data.week.previousFrom)).toBe(7 * 86_400_000)
    for (const key of ['received', 'posts', 'votes']) {
      expect(data.week[key]).toMatchObject({ current: expect.any(Number), previous: expect.any(Number) })
    }
    expect(data.projects).toHaveLength(1)
  })

  test('the overview API rejects anonymous callers and projects outside the scope', async ({ page, request }) => {
    expect((await request.get('/api/dashboard/overview')).status()).toBe(401)

    await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
    await ensureProjectContext(page.request)
    const response = await page.request.get('/api/dashboard/overview', { params: { projects: 'not-a-project' } })
    expect(response.status()).toBe(403)
  })

  test('the page labels every number and has no projects table for a single project', async ({ page }) => {
    await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
    await ensureProjectContext(page.request)
    const active = await getActiveProjectViaApi(page.request)
    await setActiveProject(page.request, active.id)

    await page.goto('/dashboard')
    const overview = page.getByTestId('dashboard-overview')
    await expect(overview.getByRole('heading', { name: 'Needs you' })).toBeVisible({ timeout: 30_000 })
    await expect(overview.getByRole('heading', { name: 'Last 7 days' })).toBeVisible()
    await expect(overview.getByText('New feedback posts')).toBeVisible()
    await expect(overview.getByText('Votes', { exact: true })).toBeVisible()
    await expect(page.getByTestId('overview-projects')).toHaveCount(0)
    await expect(page.getByTestId('project-scope-chips')).toHaveCount(0)
  })

  test('All projects adds chips and a projects table; a row switches to that project', async ({ page }) => {
    await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
    await ensureProjectContext(page.request)
    const original = await getActiveProjectViaApi(page.request)
    const extra = await createProjectViaApi(page.request, { name: `Overview ${Date.now()}` })

    try {
      const switched = await page.request.post('/api/projects/active', { data: { scope: 'all' } })
      expect(switched.ok()).toBeTruthy()

      await page.goto('/dashboard')
      await expect(page.getByTestId('project-scope-chips')).toBeVisible({ timeout: 30_000 })
      const table = page.getByTestId('overview-projects')
      await expect(table).toBeVisible()
      await expect(table.getByText('Waiting for reply')).toBeVisible()

      // Narrowing to one project drops the table and keeps the selection in the URL.
      await page.getByTestId(`project-scope-chip-${extra.project.id}`).click()
      await expect(page).toHaveURL(new RegExp(`projects=${extra.project.id}`))
      await expect(page.getByTestId('overview-projects')).toHaveCount(0)
      await page.getByTestId('project-scope-chip-clear').click()
      await expect(page.getByTestId('overview-projects')).toBeVisible()

      await page.getByTestId(`overview-project-row-${extra.project.id}`).click()
      await expect(page.getByTestId('project-scope-chips')).toHaveCount(0)
      await expect(page.getByTestId('overview-projects')).toHaveCount(0)
      const active = await getActiveProjectViaApi(page.request)
      expect(active.id).toBe(extra.project.id)
    } finally {
      await setActiveProject(page.request, original.id).catch(() => undefined)
      await deleteProjectViaApi(page.request, extra.project.slug).catch(() => undefined)
    }
  })

  test('a failed load shows an error with a retry', async ({ page }) => {
    await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
    await ensureProjectContext(page.request)

    let fail = true
    await page.route('**/api/dashboard/overview**', (route) =>
      fail ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : route.continue()
    )
    await page.goto('/dashboard')
    await expect(page.getByTestId('overview-error')).toBeVisible({ timeout: 30_000 })

    fail = false
    await page.getByTestId('overview-retry').click()
    await expect(page.getByTestId('overview-week')).toBeVisible()
    await expect(page.getByTestId('overview-error')).toHaveCount(0)
  })
})
