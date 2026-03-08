import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { selectors } from './selectors'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173'

export type ActiveTeam = {
  id: string
  name: string
  organizationId: string
}

type ListUserTeam = {
  id: string
  name: string
  organizationId: string
}

function parseTeams(payload: any): ListUserTeam[] {
  if (Array.isArray(payload)) {
    return payload as ListUserTeam[]
  }

  if (Array.isArray(payload?.data)) {
    return payload.data as ListUserTeam[]
  }

  return []
}

async function listUserTeams(request: APIRequestContext): Promise<ListUserTeam[]> {
  const response = await request.get('/api/teams/list-user')
  expect(response.ok()).toBeTruthy()

  const payload = await response.json()
  return parseTeams(payload)
}

async function listOrganizationTeams(request: APIRequestContext): Promise<ListUserTeam[]> {
  const response = await request.get('/api/teams/list-organization')
  expect(response.ok()).toBeTruthy()
  const payload = await response.json()
  return parseTeams(payload)
}

async function getSessionUserId(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/auth/get-session')
  expect(response.ok()).toBeTruthy()
  const payload = await response.json()
  const userId = payload?.user?.id || payload?.data?.user?.id
  expect(userId).toBeTruthy()
  return userId as string
}

async function setActiveTeam(request: APIRequestContext, teamId: string) {
  const response = await request.post('/api/teams/active', {
    data: { teamId },
  })
  expect(response.ok()).toBeTruthy()
}

async function addCurrentUserToTeam(request: APIRequestContext, teamId: string) {
  const userId = await getSessionUserId(request)
  const response = await request.post('/api/auth/organization/add-team-member', {
    data: { teamId, userId },
    headers: {
      origin: BASE_URL,
      referer: `${BASE_URL}/settings#team`,
    },
  })

  if (response.ok()) {
    return
  }

  const payload = await response.json().catch(() => ({}))
  const message = JSON.stringify(payload)
  if (message.toLowerCase().includes('already')) {
    return
  }

  throw new Error(`Failed to add current user to created team: ${message}`)
}

export async function ensureTeamAndOrganizationContext(request: APIRequestContext) {
  const activeResponse = await request.get('/api/teams/active')
  if (activeResponse.ok()) {
    return
  }

  const teams = await listUserTeams(request)
  expect(teams.length).toBeGreaterThan(0)
  const firstTeam = teams[0]

  const setActiveOrganizationResponse = await request.post('/api/auth/organization/set-active', {
    data: { organizationId: firstTeam.organizationId },
  })
  expect(setActiveOrganizationResponse.ok()).toBeTruthy()

  await setActiveTeam(request, firstTeam.id)
}

export async function getActiveTeamViaApi(request: APIRequestContext): Promise<ActiveTeam> {
  const response = await request.get('/api/teams/active')
  expect(response.ok()).toBeTruthy()

  const payload = await response.json()
  expect(payload?.success).toBeTruthy()
  expect(payload?.data?.id).toBeTruthy()

  return payload.data as ActiveTeam
}

export async function createTeamFromSettings(page: Page, teamName: string): Promise<ActiveTeam> {
  await ensureTeamAndOrganizationContext(page.request)

  await page.goto('/settings#team')
  await page.waitForFunction(() => {
    const tab = document.querySelector('[data-testid="settings-tab-team"]') as any
    return Boolean(tab?.__vueParentComponent)
  })

  // Resolve team context server-side and reload so settings/team observers hydrate with stable session state.
  await expect
    .poll(
      async () => {
        const response = await page.request.get('/api/teams/active')
        return response.status()
      },
      { timeout: 20_000 }
    )
    .toBe(200)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const tab = document.querySelector('[data-testid="settings-tab-team"]') as any
    return Boolean(tab?.__vueParentComponent)
  })

  await expect(page.locator(selectors.teamTitle)).toBeVisible()
  await expect(page.locator(selectors.teamOpenCreateDialog)).toBeVisible({ timeout: 20_000 })
  await page.locator(selectors.teamOpenCreateDialog).click()
  await expect(page.locator(selectors.teamCreateName)).toBeVisible()
  await page.locator(selectors.teamCreateName).fill(teamName)
  await page.locator(selectors.teamCreateSubmit).click()

  let createdTeam: ListUserTeam | null = null
  await expect
    .poll(
      async () => {
        const teams = await listOrganizationTeams(page.request)
        createdTeam = teams.find((team) => team.name === teamName) || null
        return Boolean(createdTeam)
      },
      { timeout: 20_000 }
    )
    .toBe(true)

  await addCurrentUserToTeam(page.request, createdTeam!.id)
  await setActiveTeam(page.request, createdTeam!.id)

  await expect
    .poll(
      async () => {
        const activeTeam = await getActiveTeamViaApi(page.request)
        return activeTeam.name
      },
      { timeout: 20_000 }
    )
    .toBe(teamName)

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator(selectors.teamSwitcherActiveName)).toHaveText(teamName, {
    timeout: 20_000,
  })

  const createDialog = page.getByRole('dialog', { name: 'Create Team' })
  if (await createDialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape')
    await expect(createDialog).not.toBeVisible()
  }

  return getActiveTeamViaApi(page.request)
}

type SwitchTeamParams = { teamId: string; expectedName: string } | { teamName: string }

export async function switchTeamFromSidebar(page: Page, params: SwitchTeamParams): Promise<ActiveTeam> {
  await expect(page.locator(selectors.teamSwitcherTrigger)).toBeVisible()
  await expect(page.locator(selectors.teamSwitcherTrigger)).toBeEnabled({ timeout: 20_000 })
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator(selectors.teamSwitcherTrigger).click()

    const retryMenuItem = page.getByRole('menuitem', { name: 'Retry' })
    if (!(await retryMenuItem.isVisible().catch(() => false))) {
      break
    }

    await retryMenuItem.click()
    await expect
      .poll(
        async () => {
          const response = await page.request.get('/api/teams/active')
          return response.status()
        },
        { timeout: 20_000 }
      )
      .toBe(200)

    await page.keyboard.press('Escape')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator(selectors.teamSwitcherTrigger)).toBeVisible()
    await expect(page.locator(selectors.teamSwitcherTrigger)).toBeEnabled({ timeout: 20_000 })
  }

  if ('teamId' in params) {
    const teamMenuItem = page.getByRole('menuitem').filter({ hasText: params.expectedName }).first()
    await expect(teamMenuItem).toBeVisible({ timeout: 20_000 })
    await teamMenuItem.click()
  } else {
    const teamMenuItem = page.getByRole('menuitem').filter({ hasText: params.teamName }).first()
    await expect(teamMenuItem).toBeVisible({ timeout: 20_000 })
    await teamMenuItem.click()
  }

  const expectedName = 'expectedName' in params ? params.expectedName : params.teamName

  await expect
    .poll(
      async () => {
        const activeTeam = await getActiveTeamViaApi(page.request)
        return activeTeam.name
      },
      { timeout: 20_000 }
    )
    .toBe(expectedName)

  await expect(page.locator(selectors.teamSwitcherActiveName)).toHaveText(expectedName)
  return getActiveTeamViaApi(page.request)
}
