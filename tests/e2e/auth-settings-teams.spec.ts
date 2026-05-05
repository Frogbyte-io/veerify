import { expect, test } from '@playwright/test'
import { expectRedirectToLogin, loginViaProgrammaticPage, loginViaUi } from './helpers/auth'
import { selectors } from './helpers/selectors'
import {
  createTeamFromSettings,
  ensureTeamAndOrganizationContext,
  getActiveTeamViaApi,
  switchTeamFromSidebar,
} from './helpers/teams'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

test.setTimeout(60_000)

test('unauthenticated user is redirected from protected route to login', async ({ page }) => {
  await expectRedirectToLogin(page, '/settings')
})

test('root loading splash describes feedback collection before redirecting to login', async ({ page }) => {
  const sessionPath = '**/api/auth/get-session**'

  await page.route(sessionPath, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    await route.continue()
  })

  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: 'Veerify' })).toBeVisible()
  await expect(page.getByText('Feedback collection and management')).toBeVisible()
  await expect(page.getByText('Feedback management and verification')).toHaveCount(0)

  await expect(page).toHaveURL(/\/login/)
  await expect(page.locator(selectors.loginEmail)).toBeVisible()

  await page.unroute(sessionPath)
})

test('user can sign in through login form and land in dashboard', async ({ page }) => {
  await loginViaUi(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
})

test('onboarding slug mirrors the full workspace name while typing', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

  await page.goto('/onboarding')
  await expect(page.getByRole('heading', { name: 'Create your workspace' })).toBeVisible()

  const workspaceNameInput = page.getByLabel('Workspace name')
  const workspaceSlugInput = page.getByLabel('URL')

  await workspaceNameInput.click()
  await workspaceNameInput.type('Frogbyte', { delay: 40 })
  await expect(workspaceSlugInput).toHaveValue('frogbyte')

  await workspaceNameInput.type(' Labs', { delay: 40 })
  await expect(workspaceSlugInput).toHaveValue('frogbyte-labs')
})

test('team creation slug mirrors the full team name while typing', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  await ensureTeamAndOrganizationContext(page.request)

  await page.goto('/settings#team')
  await page.waitForFunction(() => {
    const tab = document.querySelector('[data-testid="settings-tab-team"]') as any
    return Boolean(tab?.__vueParentComponent)
  })

  await expect(page.locator(selectors.teamOpenCreateDialog)).toBeVisible({ timeout: 20_000 })
  await page.locator(selectors.teamOpenCreateDialog).click()

  const createDialog = page.getByRole('dialog', { name: 'Create Team' })
  const teamNameInput = createDialog.getByLabel('Team Name')
  const teamSlugInput = createDialog.getByLabel('Subdomain Slug')

  await teamNameInput.click()
  await teamNameInput.type('DotMatrixLabs', { delay: 40 })
  await expect(teamSlugInput).toHaveValue('dotmatrixlabs')

  await teamNameInput.type(' Ops', { delay: 40 })
  await expect(teamSlugInput).toHaveValue('dotmatrixlabs-ops')
})

test('product creation slug mirrors the full product name while typing', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  await ensureTeamAndOrganizationContext(page.request)

  await page.goto('/products')
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible()

  await page.getByRole('button', { name: 'New Product' }).click()

  const createDialog = page.getByRole('dialog', { name: 'Create New Product' })
  const productNameInput = createDialog.getByLabel('Product Name')
  const productSlugInput = createDialog.getByLabel('URL Slug')

  await productNameInput.click()
  await productNameInput.type('DotMatrixLabs', { delay: 40 })
  await expect(productSlugInput).toHaveValue('dotmatrixlabs')

  await productNameInput.type(' Ops', { delay: 40 })
  await expect(productSlugInput).toHaveValue('dotmatrixlabs-ops')
})

test('settings navigation tabs render expected sections', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

  await page.goto('/settings')
  await page.waitForFunction(() => {
    const tab = document.querySelector('[data-testid="settings-tab-profile"]') as any
    return Boolean(tab?.__vueParentComponent)
  })

  await page.locator(selectors.settingsTabProfile).click()
  await expect(page).toHaveURL(/#profile/)
  await expect(page.getByRole('heading', { name: 'Profile Information' })).toBeVisible()

  await page.locator(selectors.settingsTabSecurity).click()
  await expect(page).toHaveURL(/#security/)
  await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible()
  await expect(page.locator(selectors.securityTwoFactorStatusCard)).toBeVisible()
  await expect(page.locator(selectors.securityTwoFactorEnableCallout)).toBeVisible()

  const enableCalloutClasses = await page.locator(selectors.securityTwoFactorEnableCallout).getAttribute('class')
  expect(enableCalloutClasses).toContain('bg-primary/10')
  expect(enableCalloutClasses).toContain('border-primary/20')

  const statusIconBox = await page.locator(selectors.securityTwoFactorStatusIcon).boundingBox()
  const calloutIconBox = await page.locator(selectors.securityTwoFactorEnableCalloutIcon).boundingBox()

  expect(statusIconBox).not.toBeNull()
  expect(calloutIconBox).not.toBeNull()
  expect(Math.abs((statusIconBox?.width || 0) - (statusIconBox?.height || 0))).toBeLessThanOrEqual(1)
  expect(Math.abs((calloutIconBox?.width || 0) - (calloutIconBox?.height || 0))).toBeLessThanOrEqual(1)

  await page.locator(selectors.settingsTabNotifications).click()
  await expect(page).toHaveURL(/#notifications/)
  await expect(page.getByRole('heading', { name: 'Notification Preferences' })).toBeVisible()

  await page.locator(selectors.settingsTabOrganization).click()
  await expect(page).toHaveURL(/#organization/)
  await expect(page.locator(selectors.organizationTitle)).toBeVisible()

  await page.locator(selectors.settingsTabTeam).click()
  await expect(page).toHaveURL(/#team/)
  await expect(page.locator(selectors.teamTitle)).toBeVisible()

  await page.locator(selectors.settingsTabBilling).click()
  await expect(page).toHaveURL(/#billing/)
  await expect(page.locator(selectors.settingsBillingPanel)).toBeVisible()

  await page.locator(selectors.settingsTabAppearance).click()
  await expect(page).toHaveURL(/#appearance/)
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()
})

test('settings team tab renders immediately when organization lookup is slow', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  await ensureTeamAndOrganizationContext(page.request)

  const organizationPath = '**/api/auth/organization/get-full-organization'
  const organizationResponse = page.waitForResponse((response) =>
    response.url().includes('/api/auth/organization/get-full-organization')
  )

  await page.route(organizationPath, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    await route.continue()
  })

  await page.goto('/settings', { waitUntil: 'domcontentloaded' })
  await expect(page.locator(selectors.settingsTabTeam)).toBeVisible({ timeout: 250 })

  await organizationResponse
  await page.unroute(organizationPath)
})

test('user can create a new team from settings team tab', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const teamName = `E2E Team ${Date.now()}`
  const createdTeam = await createTeamFromSettings(page, teamName)

  expect(createdTeam.name).toBe(teamName)
})

test('user can switch teams using sidebar team switcher', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const teamA = await createTeamFromSettings(page, `E2E Switch Team A ${Date.now()}`)
  const teamB = await createTeamFromSettings(page, `E2E Switch Team B ${Date.now()}`)

  const switchedToTeamA = await switchTeamFromSidebar(page, {
    teamId: teamA.id,
    expectedName: teamA.name,
  })
  expect(switchedToTeamA.id).toBe(teamA.id)
  expect(switchedToTeamA.name).toBe(teamA.name)

  const switchedBack = await switchTeamFromSidebar(page, {
    teamId: teamB.id,
    expectedName: teamB.name,
  })
  expect(switchedBack.id).toBe(teamB.id)

  const activeTeam = await getActiveTeamViaApi(page.request)
  expect(activeTeam.id).toBe(teamB.id)
  expect(activeTeam.name).toBe(teamB.name)
})

test('sidebar team switcher data stays cached across client-side route changes', async ({ page }) => {
  const bootstrapPath = '/api/dashboard/bootstrap'
  const oldInitialLoadPaths = [
    '/api/teams/list-user',
    '/api/teams/active',
    '/api/auth/organization/get-full-organization',
    '/api/dashboard/stats',
    '/api/notifications/unread-count',
  ]
  let bootstrapRequestCount = 0
  let listUserTeamsRequestCount = 0
  const oldInitialLoadRequestCounts = new Map(oldInitialLoadPaths.map((path) => [path, 0]))

  page.on('request', (request) => {
    const url = request.url()
    if (url.includes(bootstrapPath)) {
      bootstrapRequestCount += 1
    }
    if (url.includes('/api/teams/list-user')) {
      listUserTeamsRequestCount += 1
    }
    for (const path of oldInitialLoadPaths) {
      if (url.includes(path)) {
        oldInitialLoadRequestCounts.set(path, (oldInitialLoadRequestCounts.get(path) || 0) + 1)
      }
    }
  })

  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  await page.goto('/dashboard')
  await expect(page.locator(selectors.teamSwitcherActiveName)).toBeVisible({ timeout: 20_000 })

  await expect.poll(() => bootstrapRequestCount, { timeout: 20_000 }).toBeGreaterThan(0)
  for (const path of oldInitialLoadPaths) {
    expect(oldInitialLoadRequestCounts.get(path), `${path} should not be part of initial dashboard load`).toBe(0)
  }

  const baselineRequestCount = listUserTeamsRequestCount

  await page.locator('[data-testid="app-sidebar"] a[href="/feedback"]').click()
  await expect(page).toHaveURL(/\/feedback/)
  await expect(page.locator(selectors.teamSwitcherActiveName)).toBeVisible()
  await expect(page.locator(selectors.teamSwitcherTrigger)).not.toContainText('Loading teams...')

  await page.locator('[data-testid="app-sidebar"] a[href="/products"]').click()
  await expect(page).toHaveURL(/\/products/)
  await expect(page.locator(selectors.teamSwitcherActiveName)).toBeVisible()
  await expect(page.locator(selectors.teamSwitcherTrigger)).not.toContainText('Loading teams...')

  expect(listUserTeamsRequestCount).toBe(baselineRequestCount)
})

test('dashboard bootstrap returns workspace context for authenticated users', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  await ensureTeamAndOrganizationContext(page.request)

  const response = await page.request.get('/api/dashboard/bootstrap')
  expect(response.ok()).toBeTruthy()

  const payload = await response.json()
  expect(payload.success).toBeTruthy()
  expect(payload.data.session.user.email).toBe(TEST_EMAIL)
  expect(payload.data.teamContext.teams.length).toBeGreaterThan(0)
  expect(payload.data.teamContext.activeTeam.id).toBeTruthy()
  expect(payload.data.workspace.stats).toMatchObject({
    totalFeedback: expect.any(Number),
    projectCount: expect.any(Number),
    memberCount: expect.any(Number),
  })
  expect(payload.data.notifications.unreadCount).toEqual(expect.any(Number))
})

test('dashboard bootstrap rejects unauthenticated users', async ({ request }) => {
  const response = await request.get('/api/dashboard/bootstrap')
  expect(response.status()).toBe(401)
})

test('sidebar user section stays hydrated across client-side route changes', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  await page.goto('/dashboard')

  await expect(page.locator(selectors.navUserTrigger)).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(selectors.navUserName)).toBeVisible()
  await expect(page.locator(selectors.navUserLoading)).toHaveCount(0)

  await page.locator('[data-testid="app-sidebar"] a[href="/feedback"]').click()
  await expect(page).toHaveURL(/\/feedback/)
  await expect(page.locator(selectors.navUserTrigger)).toBeVisible()
  await expect(page.locator(selectors.navUserLoading)).toHaveCount(0)

  await page.locator('[data-testid="app-sidebar"] a[href="/products"]').click()
  await expect(page).toHaveURL(/\/products/)
  await expect(page.locator(selectors.navUserTrigger)).toBeVisible()
  await expect(page.locator(selectors.navUserLoading)).toHaveCount(0)
})

test('roadmap and changelog sidebar buttons are disabled', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  await page.goto('/dashboard')

  const sidebar = page.locator('[data-testid="app-sidebar"]')
  const roadmapButton = sidebar.getByRole('button', { name: 'Roadmap' })
  const changelogButton = sidebar.getByRole('button', { name: 'Changelog' })

  await expect(roadmapButton).toBeDisabled()
  await expect(changelogButton).toBeDisabled()
  await expect(sidebar.locator('a[href="/roadmap"]')).toHaveCount(0)
  await expect(sidebar.locator('a[href="/changelog"]')).toHaveCount(0)
})

test('settings team panel tracks active team selected in sidebar', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const teamA = await createTeamFromSettings(page, `E2E Settings Team A ${Date.now()}`)
  const teamB = await createTeamFromSettings(page, `E2E Settings Team B ${Date.now()}`)

  await expect(page.locator(selectors.teamNameInput)).toBeVisible()
  await expect(page.getByText('No active team. Create a team to continue.')).toHaveCount(0)
  await expect(page.locator(selectors.teamNameInput)).toHaveValue(teamB.name)

  await switchTeamFromSidebar(page, {
    teamId: teamA.id,
    expectedName: teamA.name,
  })
  await expect(page.locator(selectors.teamNameInput)).toHaveValue(teamA.name)
  await expect(page.getByText('No active team. Create a team to continue.')).toHaveCount(0)

  await switchTeamFromSidebar(page, { teamId: teamB.id, expectedName: teamB.name })
  await expect(page.locator(selectors.teamNameInput)).toHaveValue(teamB.name)
  await expect(page.getByText('No active team. Create a team to continue.')).toHaveCount(0)
})

test('team settings show pending invites and allow reminder and revoke actions', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

  await createTeamFromSettings(page, `E2E Invite Team ${Date.now()}`)

  const inviteEmail = `pending-team-invite-${Date.now()}@example.com`

  await expect(page.getByRole('button', { name: 'Invite to Team' })).toBeVisible()
  await page.getByRole('button', { name: 'Invite to Team' }).click()

  const inviteDialog = page.getByRole('dialog', { name: 'Invite to Team' })
  await expect(inviteDialog).toBeVisible()
  await inviteDialog.getByLabel('Email').fill(inviteEmail)
  await inviteDialog.getByRole('button', { name: 'Send Invite' }).click()

  const pendingInvites = page.locator(selectors.teamPendingInvitations)
  await expect(pendingInvites).toBeVisible({ timeout: 20_000 })

  const inviteRow = pendingInvites.locator(selectors.teamPendingInvitationRow).filter({ hasText: inviteEmail })
  await expect(inviteRow).toBeVisible({ timeout: 20_000 })

  const resendResponsePromise = page.waitForResponse((response) => {
    return (
      response.url().includes('/api/organizations/invite') &&
      response.request().method() === 'POST' &&
      (response.request().postData() || '').includes('"resend":true')
    )
  })

  await inviteRow.getByRole('button', { name: 'Send reminder' }).click()
  const resendResponse = await resendResponsePromise
  expect(resendResponse.ok()).toBeTruthy()
  await expect(inviteRow).toBeVisible()

  await inviteRow.getByRole('button', { name: 'Revoke' }).click()
  await expect(inviteRow).toHaveCount(0)
})
