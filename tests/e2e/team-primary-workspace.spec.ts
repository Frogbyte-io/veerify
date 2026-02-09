import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

async function ensureSignedIn(page: Page) {
  await page.goto('/login')

  if (page.url().includes('/dashboard')) {
    return
  }

  await page.getByLabel('Email').fill(TEST_EMAIL)
  await page.getByLabel('Password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

test('team workspace products use org slug only for public URLs', async ({ page }) => {
  await ensureSignedIn(page)

  await page.goto('/products')
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible()
  await expect(page.getByText('Manage your products and their public feedback pages')).toBeVisible()

  // Team switcher should expose teams as the operational context.
  await expect(page.locator('text=Default').first()).toBeVisible()
  await page.locator('text=Default').first().click()
  await expect(page.locator('text=Teams')).toBeVisible()
  await expect(page.locator('text=Manage teams')).toBeVisible()
  await page.keyboard.press('Escape')

  // Public URL contract stays orgSlug + projectSlug.
  await expect(page.getByRole('link', { name: 'View Public Page' }).first()).toHaveAttribute(
    'href',
    /\/p\/preview-org\/demo$/
  )

  // Slug uniqueness conflict copy should use workspace wording.
  let conflictMessage = ''
  page.once('dialog', async (dialog) => {
    conflictMessage = dialog.message()
    await dialog.accept()
  })

  await page.getByRole('button', { name: 'New Product' }).click()
  await page.getByLabel('Product Name').fill('Duplicate Demo')
  await page.getByLabel('URL Slug').fill('demo')
  await page.getByRole('button', { name: 'Create Product' }).click()

  await expect.poll(() => conflictMessage).toContain('workspace URL namespace')
})
