import { expect, test } from '@playwright/test'

test.describe('API docs', () => {
  test('serves OpenAPI JSON and Scalar UI', async ({ request }) => {
    const specResponse = await request.get('/api/openapi.json')
    expect(specResponse.ok()).toBe(true)
    const specBody = await specResponse.text()
    expect(specBody).toContain('"openapi"')

    const docsResponse = await request.get('/api-docs')
    expect(docsResponse.ok()).toBe(true)
    const docsBody = await docsResponse.text()
    expect(docsBody.toLowerCase()).toContain('scalar')
  })
})
