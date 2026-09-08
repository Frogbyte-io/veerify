import { expect, test } from '@playwright/test'

test.describe('API docs', () => {
  test('serves OpenAPI JSON and Scalar UI', async ({ request, page }) => {
    const specResponse = await request.get('/api/openapi.json')
    expect(specResponse.ok()).toBe(true)
    const specBody = await specResponse.text()
    expect(specBody).toContain('"openapi"')
    const spec = JSON.parse(specBody)
    const conversationListParameters =
      spec.paths?.['/api/support/conversations']?.get?.parameters?.map(
        (parameter: { in?: string; name?: string; schema?: { enum?: string[] } }) => parameter
      ) || []
    expect(conversationListParameters).toContainEqual(
      expect.objectContaining({
        in: 'query',
        name: 'view',
        schema: expect.objectContaining({ enum: ['unassigned', 'assigned-to-me', 'resolved', 'all'] }),
      })
    )

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
