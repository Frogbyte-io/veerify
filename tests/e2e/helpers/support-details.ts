import { expect, type Locator, type Page } from '@playwright/test'

// Status, priority, assignee, tags and the feedback bridge live in the
// conversation details panel. On wide panes it sits beside the thread; at the
// default test viewport it is a slide-over that has to be opened (and closed
// again before the thread or composer can be used).

export async function openThreadDetails(page: Page): Promise<Locator> {
  const panel = page.getByTestId('support-conversation-details')
  if (!(await panel.isVisible())) {
    await page.getByTestId('support-thread-details-toggle').click()
    await expect(panel).toBeVisible()
  }
  return panel
}

export async function closeThreadDetails(page: Page): Promise<void> {
  const sheet = page.getByTestId('support-details-sheet')
  if (await sheet.isVisible()) {
    await sheet.getByTestId('support-details-close').click()
    await expect(sheet).toBeHidden()
  }
}

/** Run `fn` with the details panel open, then close it again if it is a slide-over. */
export async function withThreadDetails(page: Page, fn: (panel: Locator) => Promise<void>): Promise<void> {
  const panel = await openThreadDetails(page)
  try {
    await fn(panel)
  } finally {
    await closeThreadDetails(page)
  }
}
