import { expect, test, type Browser, type BrowserContext } from '@playwright/test'
import {
  cleanupSupportPermissionFixture,
  createSupportPermissionFixture,
  type SupportPermissionFixture,
  type SupportPermissionRole,
} from './helpers/support-permissions'
import { loginViaProgrammaticPage, withOriginHeaders } from './helpers/auth'

test.describe.serial('support permission-aware navigation', () => {
  let fixture: SupportPermissionFixture
  const contexts: BrowserContext[] = []

  test.beforeAll(async ({ request }) => {
    fixture = await createSupportPermissionFixture(request)
  })

  test.afterAll(async () => {
    await Promise.all(contexts.map((context) => context.close()))
    if (fixture) await cleanupSupportPermissionFixture(fixture)
  })

  async function openAs(browser: Browser, role: SupportPermissionRole, path?: string) {
    path ||= `/support/settings?inboxId=${fixture.primaryInboxId}`
    const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4913'
    const context = await browser.newContext({
      baseURL,
    })
    contexts.push(context)
    const page = await context.newPage()
    await loginViaProgrammaticPage(page, fixture.users[role])
    const preAuthSession = await page.request.get('/api/auth/session')
    const preAuthPayload = await preAuthSession.json().catch(() => null)
    if (!preAuthPayload?.data?.session?.id) {
      throw new Error(`Programmatic page login did not persist session (status=${preAuthSession.status()})`)
    }
    const cookies = await context.cookies()
    const activeTeamResponse = await page.request.post('/api/teams/active', {
      headers: withOriginHeaders('/support'),
      data: { teamId: fixture.teamId },
    })
    if (!activeTeamResponse.ok()) {
      throw new Error(`Could not activate the fixed team for ${role}: ${await activeTeamResponse.text()}`)
    }
    const sessionResponse = await page.request.get('/api/auth/session')
    const sessionPayload = await sessionResponse.json().catch(() => null)
    const sessionId = sessionPayload?.data?.session?.id
    const sessionUserId = sessionPayload?.data?.user?.id
    const sessionEmail = sessionPayload?.data?.user?.email
    if (!sessionResponse.ok() || !sessionId || !sessionUserId || cookies.length === 0) {
      throw new Error(
        `Programmatic login did not establish a browser session (status=${sessionResponse.status()}, ` +
          `user=${sessionUserId || 'missing'}, session=${sessionId || 'missing'}, cookies=${cookies.length})`
      )
    }
    if (sessionUserId !== fixture.users[role].userId) {
      throw new Error(`Programmatic login resolved the wrong user for ${role}: ${sessionEmail || sessionUserId}`)
    }
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    await expect(page).not.toHaveURL(/\/login/)
    const postNavigationSession = await page.request.get('/api/auth/session')
    const postNavigationPayload = await postNavigationSession.json().catch(() => null)
    const postNavigationUserId = postNavigationPayload?.data?.user?.id
    if (postNavigationUserId !== fixture.users[role].userId) {
      throw new Error(
        `Navigation changed the authenticated user for ${role}: ${postNavigationPayload?.data?.user?.email || postNavigationUserId}`
      )
    }
    return page
  }

  test('team admin sees team policy and inbox administration', async ({ browser }) => {
    const page = await openAs(browser, 'teamAdmin')

    const channelRequest = page.waitForRequest(
      (request) => request.url().includes('/api/support/channel-status') && request.method() === 'GET'
    )
    await page.reload({ waitUntil: 'domcontentloaded' })
    expect(new URL((await channelRequest).url()).searchParams.get('inboxId')).toBe(fixture.primaryInboxId)

    await expect(page.getByTestId('support-team-policy')).toBeVisible()
    await expect(page.getByText('Automatically link signed-in customer feedback')).toBeVisible()
    await expect(page.getByTestId('support-add-inbox-member')).toBeVisible()
    await expect(page.getByTestId('support-inbox-settings-save')).toBeVisible()
    await expect(page.getByText('Works conversations and applies existing tags.')).toBeVisible()
    await page.locator('#new-member-role').selectOption('supervisor')
    await expect(page.getByText('Also manages the shared tag list.')).toBeVisible()
    await page.locator('#new-member-role').selectOption('admin')
    await expect(page.getByText('Also manages inbox settings and members.')).toBeVisible()
  })

  test('team admin gets explicit confirmation before removing their own inbox access', async ({ browser }) => {
    const page = await openAs(browser, 'teamAdmin')
    const memberRow = page.locator('[data-testid="support-inbox-member-row"]').filter({
      hasText: fixture.users.teamAdmin.email,
    })

    await memberRow
      .getByRole('button', { name: `Remove inbox member Permissions teamAdmin (${fixture.users.teamAdmin.email})` })
      .click()
    const removalDialog = page.getByRole('dialog')
    await expect(removalDialog).toContainText('You will lose access to this inbox')
    await expect(removalDialog.getByRole('button', { name: 'Remove member' })).toBeVisible()
  })

  test('inbox admin can manage inbox members but not team policy', async ({ browser }) => {
    const page = await openAs(browser, 'inboxAdmin')

    await expect(page.getByTestId('support-add-inbox-member')).toBeVisible()
    await expect(page.getByTestId('support-team-policy')).toHaveCount(0)
  })

  test('supervisor manages tags and receives descriptive role choices', async ({ browser }) => {
    const page = await openAs(browser, 'supervisor', '/support')

    await expect(page.getByRole('button', { name: 'Create tag' })).toBeVisible()
    await page.goto('/support/settings', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('support-add-inbox-member')).toHaveCount(0)
  })

  test('agent keeps conversation work but has no administrative controls', async ({ browser }) => {
    const page = await openAs(browser, 'agent')

    await expect(page.getByRole('button', { name: 'Add inbox member' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Create tag' })).toHaveCount(0)
    await expect(page.getByTestId('support-inbox-settings-save')).toHaveCount(0)
    await expect(page.locator('#general-name')).toHaveAttribute('readonly', '')
  })

  test('unassigned member gets an intentional empty state without inbox names', async ({ browser }) => {
    const page = await openAs(browser, 'unassigned', '/support')

    await expect(page.getByTestId('support-no-assignment')).toBeVisible()
    await expect(page.getByTestId('support-filter-status')).toHaveCount(0)
    await expect(page.getByTestId('support-filter-assignee')).toHaveCount(0)
    await expect(page.getByTestId('support-filter-tag')).toHaveCount(0)
    await expect(page.getByText(fixture.primaryInboxName)).toHaveCount(0)
    await expect(page.getByText(fixture.forbiddenInboxName)).toHaveCount(0)
  })

  test('settings deep link recovers from an inaccessible inbox without revealing its name', async ({ browser }) => {
    const page = await openAs(browser, 'agent', `/support/settings?inboxId=${fixture.forbiddenInboxId}`)

    await expect(page.getByTestId('support-inbox-access-error')).toHaveText(
      'You do not have access to this support inbox'
    )
    await expect(page.getByText(fixture.forbiddenInboxName)).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`inboxId=${fixture.primaryInboxId}`))
  })

  test('settings recovers when inbox access is revoked between list and detail requests', async ({ browser }) => {
    const page = await openAs(browser, 'agent')
    let listCalls = 0
    await page.route('**/api/support/inboxes?*', async (route) => {
      listCalls += 1
      if (listCalls === 1) return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { inboxes: [] } }),
      })
    })
    await page.route(`**/api/support/inboxes/${fixture.primaryInboxId}/members**`, async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { message: 'You do not have access to this support inbox' } }),
      })
    })

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('support-inbox-access-error')).toHaveText(
      'You do not have access to this support inbox'
    )
    await expect(page.getByTestId('support-no-assignment')).toBeVisible()
    await expect(page.getByText(fixture.primaryInboxName)).toHaveCount(0)
  })

  test('forbidden deep-link shows generic access and recovers to first accessible inbox', async ({ browser }) => {
    const page = await openAs(
      browser,
      'agent',
      `/support?inboxId=${fixture.forbiddenInboxId}&conversationId=${fixture.forbiddenConversationId}`
    )

    await expect(page.getByTestId('support-inbox-access-error')).toHaveText(
      'You do not have access to this support inbox'
    )
    await expect(page.getByTestId(`support-inbox-switch-${fixture.primaryInboxId}`)).toBeVisible()
    await expect(page.getByText(fixture.forbiddenInboxName)).toHaveCount(0)
  })
})
