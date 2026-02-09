import { expect, test } from '@playwright/test'
import { expectRedirectToLogin, loginViaUi } from './helpers/auth'
import { selectors } from './helpers/selectors'
import { createTeamFromSettings, getActiveTeamViaApi, switchTeamFromSidebar } from './helpers/teams'

// TODO: add org-settings e2e when dedicated organization governance page exists.

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

test.setTimeout(120_000)

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
