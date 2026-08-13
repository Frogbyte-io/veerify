import { expect, test } from '@playwright/test'
import { loginViaProgrammaticPage } from './helpers/auth'

const PORT = Number(process.env.PLAYWRIGHT_PORT || 4173)
const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

test.setTimeout(120_000)

test('create-product migration flow imports csv content and publishes a public changelog entry', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const teamResponse = await page.request.get('/api/teams/active')
  expect(teamResponse.ok()).toBeTruthy()
  const teamPayload = await teamResponse.json()
  const teamSlug = teamPayload?.data?.slug as string
  expect(teamSlug).toBeTruthy()

  const productName = `Migrated Product ${Date.now()}`
  const productSlug = `migrated-product-${Date.now()}`
  const csvContent = [
    'record_type,external_id,title,body,category,status,feedback_external_id,email',
    'feedback,fb_1,Need import history,Customers want to inspect prior migrations,Feature Request,Open,,',
    'roadmap,road_1,Improve migration UX,Add better review screens,Migration,Planned,,',
    'changelog,ch_1,Migration launch,Imported changelog post,Release,,,',
    'comment,comment_1,,Following this import,,,fb_1,',
    'subscription,sub_1,,,,,fb_1,watcher@example.com',
  ].join('\n')

  await page.goto('/products', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'New Product' }).click()
  await page.locator('#name').fill(productName)
  await expect(page.locator('#slug')).toHaveValue(productSlug)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Migrate existing board' }).click()

  await page.waitForURL(new RegExp(`/products/${productSlug}#import$`), { timeout: 30_000 })
  await expect(page.getByText('Import Existing Board')).toBeVisible()

  await page.getByRole('button', { name: 'Generic CSV' }).click()
  await page.locator('#import-csv-content').fill(csvContent)
  await page.getByRole('button', { name: 'Run Dry-Run' }).click()

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/projects/${productSlug}/imports`)
        const payload = await response.json()
        return payload?.data?.[0]?.status || null
      },
      { timeout: 30_000 }
    )
    .toBe('ready')

  await expect(page.getByText('Migration launch')).not.toBeVisible()
  await page.getByRole('button', { name: 'Start Import' }).click()

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/projects/${productSlug}/imports`)
        const payload = await response.json()
        return payload?.data?.[0]?.status || null
      },
      { timeout: 30_000 }
    )
    .toBe('completed')

  await page.locator('[data-testid="product-settings-tab-changelog"]').click()
  await expect(page.getByText('Migration launch')).toBeVisible()
  await expect(page.getByText('Draft')).toBeVisible()
  await page.getByRole('button', { name: 'Publish' }).click()

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/projects/${productSlug}/changelog`)
        const payload = await response.json()
        return payload?.data?.[0]?.isDraft
      },
      { timeout: 20_000 }
    )
    .toBe(false)

  const publicChangelogUrl = `http://${teamSlug}.localhost:${PORT}/${productSlug}/changelog`
  await page.goto(publicChangelogUrl, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: productName })).toBeVisible()
  await expect(page.getByText('Migration launch')).toBeVisible()
  await expect(page.locator('[data-testid^="public-changelog-post-"]').first()).toBeVisible()
})
