import { expect, test } from '@playwright/test'
import { expectRedirectToLogin, loginViaProgrammaticPage } from './helpers/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

test.describe('reports availability', () => {
  test('authenticated users see the unavailable notice without fake analytics', async ({ page }) => {
    await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
    await page.goto('/reports', { waitUntil: 'domcontentloaded' })

    await expect(page).toHaveURL(/\/reports$/)

    const reportsPage = page.getByTestId('reports-unavailable')
    await expect(reportsPage).toBeVisible()
    await expect(reportsPage.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible()
    await expect(reportsPage.getByRole('heading', { name: 'Reporting is not available yet', level: 2 })).toBeVisible()
    await expect(
      reportsPage.getByText(
        'Analytics will appear here when reporting is available. No report data is currently shown.'
      )
    ).toBeVisible()

    for (const metric of ['1,247', '3,284', '78.5%', '2.4d']) {
      await expect(reportsPage.getByText(metric, { exact: true })).toHaveCount(0)
    }

    for (const fabricatedSection of [
      'Feedback Trend',
      'Feature Status',
      'Top Contributors',
      'Popular Categories',
      'Export Reports',
      'Apply Filters',
    ]) {
      await expect(reportsPage.getByText(fabricatedSection, { exact: true })).toHaveCount(0)
    }

    await expect(reportsPage.locator('select')).toHaveCount(0)
    await expect(reportsPage.locator('button')).toHaveCount(0)
  })

  test('unauthenticated users are still redirected to login', async ({ page }) => {
    await expectRedirectToLogin(page, '/reports')
  })
})
