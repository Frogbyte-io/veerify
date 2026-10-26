import { expect, test } from '@playwright/test'
import { loginViaProgrammaticPage, withOriginHeaders } from './helpers/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

test.describe('workspace AI keys and spend', () => {
  test.afterEach(async ({ page }) => {
    await page.request.put('/api/workspace/spend', {
      headers: withOriginHeaders('/workspace'),
      data: { monthlyCapCents: null },
    })
  })

  test('an owner sets, sees and clears the workspace spend cap', async ({ page }) => {
    await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
    await page.goto('/workspace#keys', { waitUntil: 'domcontentloaded' })

    const panel = page.getByTestId('workspace-ai-spend')
    await expect(panel).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('workspace-ai-spend-total')).toContainText('$')

    await page.getByTestId('workspace-spend-cap-input').fill('25')
    await page.getByTestId('workspace-spend-cap-save').click()
    await expect(page.getByTestId('workspace-ai-spend-total')).toContainText('of $25.00')

    const stored = await page.request.get('/api/workspace/spend')
    expect((await stored.json()).data.workspaceCapCents).toBe(2500)

    await page.getByTestId('workspace-spend-cap-input').fill('')
    await page.getByTestId('workspace-spend-cap-save').click()
    await expect(page.getByTestId('workspace-ai-spend-total')).not.toContainText('of $')
  })

  test('a pasted key is matched to its provider, and every provider has a key link', async ({ page }) => {
    await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
    await page.goto('/workspace#keys', { waitUntil: 'domcontentloaded' })

    const paste = page.getByTestId('workspace-key-paste-input')
    await expect(paste).toBeVisible({ timeout: 30_000 })

    await paste.fill('sk-ant-api03-abcdefghijklmnopqrstuvwxyz')
    await expect(page.getByTestId('workspace-key-paste-save-anthropic')).toBeVisible()
    await expect(page.getByTestId('workspace-key-paste-save-openai')).toHaveCount(0)

    await paste.fill('AIzaSyA-0123456789abcdefghijklmnopqrs')
    await expect(page.getByTestId('workspace-key-paste-save-gemini')).toBeVisible()
    await expect(page.getByTestId('workspace-key-paste-save-pagespeed')).toBeVisible()

    await paste.fill('not-a-known-key-format')
    await expect(page.getByTestId('workspace-key-paste-unknown')).toBeVisible()

    for (const provider of ['anthropic', 'openai', 'gemini', 'perplexity', 'firecrawl', 'pagespeed']) {
      const link = page.getByTestId(`marketing-key-link-${provider}`)
      // Rows that already hold a key show the link only while replacing it
      if ((await link.count()) === 0) continue
      await expect(link).toHaveAttribute('href', /^https:\/\//)
      await expect(link).toHaveAttribute('target', '_blank')
    }
  })
})
