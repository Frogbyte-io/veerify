import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  cleanupSupportPermissionFixture,
  createSupportPermissionFixture,
  type SupportPermissionFixture,
} from './helpers/support-permissions'
import { getPlaywrightBaseURL, loginViaProgrammaticPage, withOriginHeaders } from './helpers/auth'

const SCREENSHOT_DIR = process.env.SUPPORT_RESPONSIVE_SCREENSHOT_DIR

test.describe.serial('support inbox responsive layout', () => {
  let fixture: SupportPermissionFixture
  let conversationId: string
  const contexts: BrowserContext[] = []

  test.beforeAll(async ({ request }) => {
    fixture = await createSupportPermissionFixture(request)
  })

  test.afterAll(async () => {
    await Promise.all(contexts.map((context) => context.close()))
    if (fixture) await cleanupSupportPermissionFixture(fixture)
  })

  async function openInbox(browser: Browser, viewport: { width: number; height: number }) {
    const context = await browser.newContext({ baseURL: getPlaywrightBaseURL(), viewport })
    contexts.push(context)
    const page = await context.newPage()
    await loginViaProgrammaticPage(page, fixture.users.projectAdmin)
    const activeProject = await page.request.post('/api/projects/active', {
      headers: withOriginHeaders('/inbox'),
      data: { projectId: fixture.projectId },
    })
    expect(activeProject.ok()).toBe(true)

    if (!conversationId) {
      const contacts = await page.request.post('/api/support/contacts', {
        headers: withOriginHeaders('/inbox'),
        data: {
          projectId: fixture.projectId,
          name: 'Responsive Customer',
          email: `responsive-${Date.now()}@example.com`,
        },
      })
      expect(contacts.ok()).toBe(true)
      const contactId = (await contacts.json()).data.contact.id as string
      fixture.contactIds.push(contactId)
      const created = await page.request.post('/api/support/conversations', {
        headers: withOriginHeaders('/inbox'),
        data: { inboxId: fixture.primaryInboxId, contactId, subject: 'Responsive layout check' },
      })
      expect(created.ok()).toBe(true)
      conversationId = (await created.json()).data.conversation.id as string
      fixture.conversationIds.push(conversationId)
    }

    await page.goto(`/inbox?inboxId=${fixture.primaryInboxId}&view=all`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId(`support-conversation-${conversationId}`)).toBeVisible()
    return page
  }

  async function shot(page: Page, name: string) {
    if (SCREENSHOT_DIR) await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` })
  }

  test('phone shows one pane at a time with an inbox drawer', async ({ browser }) => {
    const page = await openInbox(browser, { width: 390, height: 844 })
    await shot(page, 'phone-list')

    await expect(page.getByTestId('support-view-unassigned')).toBeHidden()
    await page.getByTestId('support-open-inboxes').click()
    const sheet = page.getByTestId('support-inbox-sheet')
    await expect(sheet.getByTestId('support-view-unassigned')).toBeVisible()
    await shot(page, 'phone-inbox-sheet')
    await sheet.getByTestId('support-view-all').click()
    await expect(sheet).toBeHidden()

    await page.getByTestId(`support-conversation-${conversationId}`).click()
    await expect(page.getByTestId('support-thread-back')).toBeVisible()
    await expect(page.getByTestId('support-conversation-search')).toBeHidden()
    await shot(page, 'phone-thread')

    await page.getByTestId('support-thread-back').click()
    await expect(page.getByTestId('support-conversation-search')).toBeVisible()
    await expect(page.getByTestId('support-settings-link')).toHaveAttribute('href', '/inbox/settings')
  })

  test('tablet shows the list beside the thread', async ({ browser }) => {
    const page = await openInbox(browser, { width: 1024, height: 768 })
    await page.getByTestId(`support-conversation-${conversationId}`).click()
    await expect(page.getByTestId('support-conversation-search')).toBeVisible()
    await expect(page.getByTestId('support-thread-back')).toBeHidden()
    await expect(page.getByTestId('support-open-inboxes')).toBeVisible()
    await shot(page, 'tablet-thread')
  })

  test('desktop keeps the inbox sidebar with a settings link', async ({ browser }) => {
    const page = await openInbox(browser, { width: 1280, height: 800 })
    await expect(page.getByTestId('support-view-unassigned')).toBeVisible()
    await expect(page.getByTestId('support-open-inboxes')).toBeHidden()
    await expect(page.getByTestId('support-sidebar-settings-link')).toBeVisible()
    await page.getByTestId(`support-conversation-${conversationId}`).click()
    await expect(page.getByTestId('support-thread-back')).toBeHidden()
    await shot(page, 'desktop-thread')
  })

  test('settings page fits a phone and offers section links', async ({ browser }) => {
    const page = await openInbox(browser, { width: 390, height: 844 })
    await page.goto(`/inbox/settings?inboxId=${fixture.primaryInboxId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('support-settings-section-nav')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    await shot(page, 'phone-settings')
  })
})
