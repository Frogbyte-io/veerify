import { expect, test, type Browser, type BrowserContext } from '@playwright/test'
import {
  cleanupSupportPermissionFixture,
  createSupportPermissionFixture,
  type SupportPermissionFixture,
  type SupportPermissionRole,
} from './helpers/support-permissions'

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

  async function openAs(browser: Browser, role: SupportPermissionRole, path = '/support/settings') {
    const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4913'
    const context = await browser.newContext({
      baseURL,
    })
    contexts.push(context)
    const page = await context.newPage()
    const loginResponse = await page.request.post('/api/auth/sign-in/email', {
      data: fixture.users[role],
    })
    if (!loginResponse.ok()) {
      throw new Error(`Programmatic login failed (${loginResponse.status()}): ${await loginResponse.text()}`)
    }
    const setCookie = loginResponse.headers()['set-cookie']
    const cookieMatch = setCookie?.match(/(?:^|,\s*)([^=;,]+)=([^;]+)/)
    if (!cookieMatch) throw new Error('Programmatic login response did not include a session cookie')
    await context.addCookies([{ name: cookieMatch[1], value: cookieMatch[2], url: baseURL }])
    const cookies = await context.cookies()
    const activeTeamResponse = await page.request.post('/api/teams/active', { data: { teamId: fixture.teamId } })
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
    await expect(page.getByText(fixture.primaryInboxName)).toHaveCount(0)
    await expect(page.getByText(fixture.forbiddenInboxName)).toHaveCount(0)
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
