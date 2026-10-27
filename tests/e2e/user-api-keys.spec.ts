import { expect, test } from '@playwright/test'
import { loginViaProgrammaticPage } from './helpers/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

test.setTimeout(90_000)

test('user can create, use and revoke a personal API key', async ({ page, request }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

  await page.goto('/settings#api-keys')
  await expect(page.getByTestId('settings-page')).toHaveAttribute('data-hydrated', 'true')
  await expect(page.getByTestId('user-api-keys')).toBeVisible({ timeout: 20_000 })

  // Unique per run so the row locator below cannot match a key left by an earlier run.
  const keyName = `CLI ${Date.now()}`
  await page.getByTestId('user-api-keys-create').click()
  await page.getByTestId('user-api-key-name').fill(keyName)
  await page.getByTestId('user-api-key-submit').click()

  const secret = page.getByTestId('user-api-key-secret')
  await expect(secret).toBeVisible({ timeout: 20_000 })
  const fullKey = ((await secret.textContent()) || '').trim()
  expect(fullKey.startsWith('vfy_usr_')).toBe(true)
  await expect(page.getByTestId('user-api-key-mcp-line')).toContainText(
    `claude mcp add --transport http veerify ${new URL(page.url()).origin}/mcp --header "Authorization: Bearer ${fullKey}"`
  )
  await expect(page.getByText("Copy this key now. You won't be able to see it again.")).toBeVisible()

  // The key authenticates API calls on its own (no cookie on the `request` fixture)
  const before = await request.get('/api/projects', { headers: { Authorization: `Bearer ${fullKey}` } })
  expect(before.status()).toBe(200)

  await page.getByTestId('user-api-key-done').click()
  await expect(secret).toHaveCount(0)

  const row = page.getByTestId('user-api-key-row').filter({ hasText: keyName })
  await expect(row).toBeVisible()
  await expect(row).toContainText(fullKey.slice(0, 12))
  await expect(row).not.toContainText(fullKey)

  await row.getByTestId('user-api-key-revoke').click()
  await page.getByTestId('user-api-key-revoke-confirm').click()
  await expect(row).toContainText('Revoked')
  await expect(row.getByTestId('user-api-key-revoke')).toHaveCount(0)

  const after = await request.get('/api/projects', { headers: { Authorization: `Bearer ${fullKey}` } })
  expect(after.status()).toBe(401)
})
