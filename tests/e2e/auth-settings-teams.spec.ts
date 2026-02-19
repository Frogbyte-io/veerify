import { expect, test } from '@playwright/test'
import { expectRedirectToLogin, loginViaUi } from './helpers/auth'
import { selectors } from './helpers/selectors'
import { createTeamFromSettings, getActiveTeamViaApi, switchTeamFromSidebar } from './helpers/teams'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

test.setTimeout(60_000)

test('unauthenticated user is redirected from protected route to login', async ({ page }) => {
  await expectRedirectToLogin(page, '/settings')
})

test('user can sign in through login form and land in dashboard', async ({ page }) => {
  await loginViaUi(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
})

test('settings navigation tabs render expected sections', async ({ page }) => {
  await loginViaUi(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

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

test('user can create a new team from settings team tab', async ({ page }) => {
  await loginViaUi(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const teamName = `E2E Team ${Date.now()}`
  const createdTeam = await createTeamFromSettings(page, teamName)

  expect(createdTeam.name).toBe(teamName)
})

test('user can switch teams using sidebar team switcher', async ({ page }) => {
  await loginViaUi(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const createdTeamName = `E2E Switch Team ${Date.now()}`
  const createdTeam = await createTeamFromSettings(page, createdTeamName)

  const switchedToDefault = await switchTeamFromSidebar(page, { teamName: 'Default' })
  expect(switchedToDefault.name).toBe('Default')

  const switchedBack = await switchTeamFromSidebar(page, {
    teamId: createdTeam.id,
    expectedName: createdTeam.name,
  })
  expect(switchedBack.id).toBe(createdTeam.id)

  const activeTeam = await getActiveTeamViaApi(page.request)
  expect(activeTeam.id).toBe(createdTeam.id)
  expect(activeTeam.name).toBe(createdTeam.name)
})

test('sidebar team switcher data stays cached across client-side route changes', async ({ page }) => {
  const listUserTeamsPath = '/api/auth/organization/list-user-teams'
  let listUserTeamsRequestCount = 0

  page.on('request', (request) => {
    if (request.url().includes(listUserTeamsPath)) {
      listUserTeamsRequestCount += 1
    }
  })

  await loginViaUi(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  await expect(page.locator(selectors.teamSwitcherActiveName)).toBeVisible({ timeout: 20_000 })

  await expect
    .poll(() => listUserTeamsRequestCount, { timeout: 20_000 })
    .toBeGreaterThan(0)

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

test('sidebar user section stays hydrated across client-side route changes', async ({ page }) => {
  await loginViaUi(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

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
  await loginViaUi(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const sidebar = page.locator('[data-testid="app-sidebar"]')
  const roadmapButton = sidebar.getByRole('button', { name: 'Roadmap' })
  const changelogButton = sidebar.getByRole('button', { name: 'Changelog' })

  await expect(roadmapButton).toBeDisabled()
  await expect(changelogButton).toBeDisabled()
  await expect(sidebar.locator('a[href="/roadmap"]')).toHaveCount(0)
  await expect(sidebar.locator('a[href="/changelog"]')).toHaveCount(0)
})

test('settings team panel tracks active team selected in sidebar', async ({ page }) => {
  await loginViaUi(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const createdTeamName = `E2E Settings Team ${Date.now()}`
  const createdTeam = await createTeamFromSettings(page, createdTeamName)

  await expect(page.locator(selectors.teamNameInput)).toBeVisible()
  await expect(page.getByText('No active team. Create a team to continue.')).toHaveCount(0)

  await switchTeamFromSidebar(page, { teamName: 'Default' })
  await expect(page.locator(selectors.teamNameInput)).toHaveValue('Default')
  await expect(page.getByText('No active team. Create a team to continue.')).toHaveCount(0)

  await switchTeamFromSidebar(page, { teamId: createdTeam.id, expectedName: createdTeam.name })
  await expect(page.locator(selectors.teamNameInput)).toHaveValue(createdTeam.name)
  await expect(page.getByText('No active team. Create a team to continue.')).toHaveCount(0)
})
