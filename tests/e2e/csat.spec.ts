import { expect, test } from '@playwright/test'

test.describe('public CSAT response', () => {
  test('customer can submit a rating and follow-up comment', async ({ page }) => {
    let rated = false
    let commented = false

    await page.route('**/api/public/csat/demo-token', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              survey: {
                scale: 'csat_5',
                question: 'How was your support experience?',
                followUpQuestion: 'What could we improve?',
              },
              response: {
                status: commented ? 'complete' : rated ? 'comment_open' : 'pending_rating',
                rating: rated ? 5 : null,
                comment: commented ? 'The fast answer helped.' : null,
                respondedAt: rated ? '2026-01-15T12:00:00.000Z' : null,
                commentWindowEndsAt: rated ? '2026-01-22T12:00:00.000Z' : null,
              },
            },
          }),
        })
        return
      }

      const body = route.request().postDataJSON()
      if (body.rating) rated = true
      if (body.comment) commented = true
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { response: { rating: 5, comment: body.comment || null } } }),
      })
    })

    await page.goto('/csat/demo-token')
    await expect(page.getByTestId('csat-card')).toBeVisible()
    await page.getByTestId('csat-rating-5').click()
    await expect(page.getByTestId('csat-comment')).toBeVisible()
    await page.getByTestId('csat-comment').fill('The fast answer helped.')
    await page.getByTestId('csat-comment-submit').click()
    await expect(page.getByTestId('csat-thanks')).toBeVisible()
  })
})
