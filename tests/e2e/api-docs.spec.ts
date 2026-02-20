import { expect, test } from '@playwright/test'

test.describe('API docs', () => {
  test('serves OpenAPI JSON and Scalar UI', async ({ request, page }) => {
    const specResponse = await request.get('/api/openapi.json')
    expect(specResponse.ok()).toBe(true)
    const specBody = await specResponse.text()
    expect(specBody).toContain('"openapi"')

    const openApiFetchPromise = page.waitForResponse(
      (response) => response.request().method() === 'GET' && response.url().includes('/api/openapi.json'),
      { timeout: 30_000 }
    )

    await page.goto('/api-docs')
    await expect(page).toHaveURL(/\/api-docs/)

    const openApiFetch = await openApiFetchPromise
    expect(openApiFetch.ok()).toBe(true)

    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const text = document.body?.innerText?.toLowerCase() || ''
            return (
              text.includes('veerify api') ||
              text.includes('authentication') ||
              Boolean(document.querySelector('scalar-api-reference'))
            )
          }),
        { timeout: 30_000 }
      )
      .toBe(true)
  })
})
