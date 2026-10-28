import { expect, test, type Page } from '@playwright/test'
import { expectRedirectToLogin, loginViaProgrammaticPage, loginViaUi } from './helpers/auth'
import {
  createAndActivateProject,
  createProjectViaApi,
  deleteProjectViaApi,
  ensureProjectContext,
  getActiveProjectViaApi,
  listProjectsViaApi,
  setActiveProject,
  switchProjectFromSidebar,
} from './helpers/projects'
import { projectSettingsTabSelector, selectors, workspaceTabSelector } from './helpers/selectors'
import { cleanupWorkspaceMember, createWorkspaceMember } from './helpers/workspace-members'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'
const PERSONAL_EMAIL = process.env.E2E_PERSONAL_EMAIL || 'personal@preview.local'

const sidebarLocator = (page: Page) => page.locator('[data-testid="app-sidebar"]')

test.setTimeout(90_000)

test('unauthenticated user is redirected from protected route to login', async ({ page }) => {
  await expectRedirectToLogin(page, '/settings')
  await expectRedirectToLogin(page, '/workspace')
  await expectRedirectToLogin(page, '/project/settings')
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
  await expect(page.getByTestId('onboarding-form')).toHaveAttribute('data-hydrated', 'true')

  const workspaceNameInput = page.getByLabel('Workspace name')
  const workspaceSlugInput = page.getByLabel('URL')
  const firstProjectInput = page.getByTestId('onboarding-project-name')

  await workspaceNameInput.click()
  await workspaceNameInput.type('Frogbyte', { delay: 40 })
  await expect(workspaceSlugInput).toHaveValue('frogbyte')
  // The first project defaults to the workspace name until the user edits it.
  await expect(firstProjectInput).toHaveValue('Frogbyte')

  await workspaceNameInput.type(' Labs', { delay: 40 })
  await expect(workspaceSlugInput).toHaveValue('frogbyte-labs')
  await expect(firstProjectInput).toHaveValue('Frogbyte Labs')
})

test('onboarding creates the workspace together with its first project', async ({ page }) => {
  // The personal account has no workspace yet, which is the state onboarding is for.
  await loginViaProgrammaticPage(page, { email: PERSONAL_EMAIL, password: TEST_PASSWORD })
  const stamp = Date.now()
  const workspaceName = `E2E Onboarding ${stamp}`
  const workspaceSlug = `e2e-onboarding-${stamp}`
  const projectName = `Onboarded ${stamp}`

  try {
    await page.goto('/onboarding')
    await expect(page.getByTestId('onboarding-form')).toHaveAttribute('data-hydrated', 'true')
    await expect(page.getByLabel('Workspace name')).toBeVisible({ timeout: 20_000 })

    await page.getByLabel('Workspace name').fill(workspaceName)
    await page.getByLabel('URL').fill(workspaceSlug)
    await page.getByTestId('onboarding-project-name').fill(projectName)
    await page.getByRole('button', { name: 'Create workspace' }).click()

    await expect(page.getByRole('heading', { name: 'Invite your colleagues' })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Skip for now' }).click()
    await expect(page.getByRole('heading', { name: "You're all set!" })).toBeVisible()

    const active = await getActiveProjectViaApi(page.request)
    expect(active.name).toBe(projectName)
    expect(active.role).toBe('admin')

    const projects = await listProjectsViaApi(page.request)
    expect(projects.map((project) => project.name)).toEqual([projectName])

    await page.getByRole('button', { name: 'Go to dashboard' }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.locator(selectors.projectSwitcherActiveName)).toHaveText(projectName, { timeout: 20_000 })
  } finally {
    // Leave the personal account without a workspace so the test can run again.
    await page.request.delete(`/api/orgs/${workspaceSlug}`, { data: { confirmSlug: workspaceSlug } })
  }
})

test('project creation from the switcher mirrors the slug from the name, keeps an edited slug, and activates the project', async ({
  page,
}) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  await ensureProjectContext(page.request)

  const stamp = Date.now()
  const projectName = `DotMatrixLabs Ops ${stamp}`
  const mirroredSlug = `dotmatrixlabs-ops-${stamp}`
  const expectedSlug = `dmx-ops-${stamp}`

  await page.goto('/dashboard')
  const trigger = page.locator(selectors.projectSwitcherTrigger)
  await expect(trigger).toBeVisible({ timeout: 20_000 })
  await trigger.click()
  await page.locator(selectors.projectSwitcherCreate).click()

  const dialog = page.getByRole('dialog', { name: 'New project' })
  await expect(dialog).toBeVisible()
  await dialog.locator(selectors.projectCreateName).fill(projectName)
  // The slug follows the full name while typing and previews the public URL.
  const slugInput = dialog.locator(selectors.projectCreateSlug)
  await expect(slugInput).toHaveValue(mirroredSlug)
  await expect(dialog.getByTestId('project-create-url-preview')).toContainText(`/${mirroredSlug}`)
  // Once edited, the slug no longer follows the name.
  await slugInput.fill(expectedSlug)
  await dialog.locator(selectors.projectCreateName).fill(`${projectName} `)
  await expect(slugInput).toHaveValue(expectedSlug)
  await dialog.locator(selectors.projectCreateName).fill(projectName)
  await dialog.locator(selectors.projectCreateSubmit).click()
  await expect(dialog).toHaveCount(0)

  try {
    await expect(page.locator(selectors.projectSwitcherActiveName)).toHaveText(projectName, { timeout: 20_000 })
    const active = await getActiveProjectViaApi(page.request)
    expect(active.name).toBe(projectName)
    expect(active.slug).toBe(expectedSlug)

    // A new project starts with exactly one product that shares its name, so the product layer stays hidden.
    const detail = await page.request.get('/api/projects/active')
    const payload = await detail.json()
    expect(payload.data.products).toHaveLength(1)
    expect(payload.data.products[0].slug).toBe(expectedSlug)
  } finally {
    await deleteProjectViaApi(page.request, expectedSlug).catch(() => undefined)
  }
})

test('settings page only shows personal tabs and redirects the old workspace hashes', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  await ensureProjectContext(page.request)

  await page.goto('/settings')
  await expect(page.getByTestId('settings-page')).toHaveAttribute('data-hydrated', 'true')
  await expect(page.locator(selectors.settingsTabProfile)).toBeVisible({ timeout: 20_000 })

  await expect(page.locator(selectors.settingsTabSecurity)).toBeVisible()
  await expect(page.locator(selectors.settingsTabNotifications)).toBeVisible()
  await expect(page.locator(selectors.settingsTabAppearance)).toBeVisible()
  for (const removed of ['organization', 'team', 'tools', 'billing', 'status']) {
    await expect(page.locator(`[data-testid="settings-tab-${removed}"]`)).toHaveCount(0)
  }
  await expect(page.locator('[data-testid^="settings-tab-"]')).toHaveCount(5)

  await expect(async () => {
    await page.locator(selectors.settingsTabProfile).click()
    await expect(page).toHaveURL(/tab=profile/)
  }).toPass({ timeout: 10_000 })
  await expect(page.getByRole('heading', { name: 'Profile Information' })).toBeVisible()

  await page.locator(selectors.settingsTabSecurity).click()
  await expect(page).toHaveURL(/tab=security/)
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
  await expect(page).toHaveURL(/tab=notifications/)
  await expect(page.getByRole('heading', { name: 'Notification Preferences' })).toBeVisible()

  await page.locator(selectors.settingsTabAppearance).click()
  await expect(page).toHaveURL(/tab=appearance/)
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()

  // The sections that moved out of personal settings keep working through their old hashes.
  await page.goto('/dashboard')
  await page.goto('/settings#organization')
  await expect(page).toHaveURL(/\/workspace\?tab=general/)
  await page.goto('/dashboard')
  await page.goto('/settings#team')
  await expect(page).toHaveURL(/\/workspace\?tab=projects/)
  await page.goto('/dashboard')
  await page.goto('/settings#tools')
  await expect(page).toHaveURL(/\/project\/settings\?tab=tools/)
})

test('workspace settings render their tabs for the workspace owner', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  await ensureProjectContext(page.request)

  await page.goto('/workspace')
  await expect(page.getByTestId('workspace-page')).toHaveAttribute('data-hydrated', 'true')
  await expect(page.locator(workspaceTabSelector('general'))).toBeVisible({ timeout: 20_000 })

  for (const key of ['general', 'members', 'projects', 'keys', 'integrations', 'privacy']) {
    await expect(page.locator(workspaceTabSelector(key))).toBeVisible()
  }
  // Billing is hidden during the beta period.
  await expect(page.locator(workspaceTabSelector('billing'))).toHaveCount(0)

  await expect(page.locator(selectors.organizationTitle)).toBeVisible()

  await page.locator(workspaceTabSelector('members')).click()
  await expect(page).toHaveURL(/tab=members/)
  await expect(page.getByTestId('workspace-members')).toBeVisible()
  await expect(page.locator(selectors.organizationMembersCount)).toHaveText(/\d+\s+member(s)?/)

  await page.locator(workspaceTabSelector('projects')).click()
  await expect(page).toHaveURL(/tab=projects/)
  await expect(page.getByTestId('workspace-projects')).toBeVisible()
  await expect(page.getByTestId('workspace-project-demo')).toBeVisible({ timeout: 20_000 })

  await page.locator(workspaceTabSelector('keys')).click()
  await expect(page).toHaveURL(/tab=keys/)
  await expect(page.getByTestId('workspace-settings-keys')).toBeVisible()

  await page.locator(workspaceTabSelector('integrations')).click()
  await expect(page).toHaveURL(/tab=integrations/)
  await expect(page.getByRole('heading', { name: 'Integration status' })).toBeVisible()

  await page.locator(workspaceTabSelector('privacy')).click()
  await expect(page).toHaveURL(/tab=privacy/)
  await expect(page.getByTestId('workspace-settings-privacy')).toBeVisible()
})

test('workspace members tab shows pending invites and allows reminder and revoke actions', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  await ensureProjectContext(page.request)

  const inviteEmail = `pending-workspace-invite-${Date.now()}@example.com`

  await page.goto('/workspace#members')
  await expect(page.getByTestId('workspace-members')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Invite Member' }).click()

  const inviteDialog = page.getByRole('dialog', { name: 'Invite Member' })
  await expect(inviteDialog).toBeVisible()
  await inviteDialog.getByLabel('Email Address').fill(inviteEmail)
  await inviteDialog.getByRole('button', { name: 'Send Invitation' }).click()

  const pendingInvites = page.getByTestId('workspace-pending-invitations')
  await expect(pendingInvites).toBeVisible({ timeout: 20_000 })

  const inviteRow = pendingInvites.getByTestId('workspace-pending-invitation-row').filter({ hasText: inviteEmail })
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

test('user can switch projects using the sidebar project switcher', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  await ensureProjectContext(page.request)

  const stamp = Date.now()
  const created = [
    await createProjectViaApi(page.request, { name: `E2E Switch A ${stamp}` }),
    await createProjectViaApi(page.request, { name: `E2E Switch B ${stamp}` }),
  ]
  const [projectA, projectB] = created.map((entry) => entry.project)

  try {
    await setActiveProject(page.request, projectB!.id)
    await page.goto('/dashboard')
    await expect(page.locator(selectors.projectSwitcherActiveName)).toHaveText(projectB!.name, { timeout: 20_000 })

    const switchedToA = await switchProjectFromSidebar(page, { projectId: projectA!.id, expectedName: projectA!.name })
    expect(switchedToA.id).toBe(projectA!.id)

    const switchedBack = await switchProjectFromSidebar(page, { projectId: projectB!.id, expectedName: projectB!.name })
    expect(switchedBack.id).toBe(projectB!.id)

    const active = await getActiveProjectViaApi(page.request)
    expect(active.id).toBe(projectB!.id)
    expect(active.name).toBe(projectB!.name)
  } finally {
    for (const entry of created) await deleteProjectViaApi(page.request, entry.project.slug).catch(() => undefined)
  }
})

test('project settings follow the project selected in the sidebar', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  await ensureProjectContext(page.request)

  const stamp = Date.now()
  const [first, second] = [
    await createProjectViaApi(page.request, { name: `E2E Settings A ${stamp}` }),
    await createProjectViaApi(page.request, { name: `E2E Settings B ${stamp}` }),
  ]

  try {
    await setActiveProject(page.request, second.project.id)
    await page.goto('/project/settings#general')
    await expect(page.getByText(`${second.project.name} in `)).toBeVisible({ timeout: 20_000 })

    await switchProjectFromSidebar(page, { projectId: first.project.id, expectedName: first.project.name })
    await expect(page.getByText(`${first.project.name} in `)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(`${second.project.name} in `)).toHaveCount(0)
  } finally {
    for (const entry of [first, second])
      await deleteProjectViaApi(page.request, entry.project.slug).catch(() => undefined)
  }
})

test('sidebar project switcher data stays cached across client-side route changes', async ({ page }) => {
  const bootstrapPath = '/api/dashboard/bootstrap'
  const notInitialLoadPaths = [
    '/api/auth/organization/get-full-organization',
    '/api/dashboard/stats',
    '/api/notifications/unread-count',
  ]
  let bootstrapRequestCount = 0
  let projectListRequestCount = 0
  let organizationListRequestCount = 0
  const notInitialLoadCounts = new Map(notInitialLoadPaths.map((path) => [path, 0]))

  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === bootstrapPath) bootstrapRequestCount += 1
    if (url.pathname === '/api/projects') projectListRequestCount += 1
    if (url.pathname === '/api/organizations/list') organizationListRequestCount += 1
    if (notInitialLoadCounts.has(url.pathname)) {
      notInitialLoadCounts.set(url.pathname, (notInitialLoadCounts.get(url.pathname) || 0) + 1)
    }
  })

  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  await page.goto('/dashboard')
  await expect(page.locator(selectors.projectSwitcherActiveName)).toBeVisible({ timeout: 20_000 })

  await expect.poll(() => bootstrapRequestCount, { timeout: 20_000 }).toBeGreaterThan(0)
  for (const path of notInitialLoadPaths) {
    expect(notInitialLoadCounts.get(path), `${path} should not be part of initial dashboard load`).toBe(0)
  }

  const baselineProjects = projectListRequestCount
  const baselineOrganizations = organizationListRequestCount

  await sidebarLocator(page).locator('a[href="/feedback"]').click()
  await expect(page).toHaveURL(/\/feedback/)
  await expect(page.locator(selectors.projectSwitcherActiveName)).toBeVisible()
  await expect(page.locator(selectors.projectSwitcherTrigger)).not.toContainText('Loading')

  await sidebarLocator(page).locator('a[href="/project/settings"]').click()
  await expect(page).toHaveURL(/\/project\/settings/)
  await expect(page.locator(selectors.projectSwitcherActiveName)).toBeVisible()

  await sidebarLocator(page).locator('a[href="/workspace"]').click()
  await expect(page).toHaveURL(/\/workspace/)
  await expect(page.locator(selectors.projectSwitcherActiveName)).toBeVisible()

  expect(projectListRequestCount).toBe(baselineProjects)
  expect(organizationListRequestCount).toBe(baselineOrganizations)
})

test('dashboard bootstrap returns workspace and project context for authenticated users', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  await ensureProjectContext(page.request)

  const response = await page.request.get('/api/dashboard/bootstrap')
  expect(response.ok()).toBeTruthy()

  const payload = await response.json()
  expect(payload.success).toBeTruthy()
  expect(payload.data.session.user.email).toBe(TEST_EMAIL)
  expect(payload.data.teamContext).toBeUndefined()
  expect(payload.data.projectContext.organizations.length).toBeGreaterThan(0)
  expect(payload.data.projectContext.projects.length).toBeGreaterThan(0)
  expect(payload.data.projectContext.activeOrganization.id).toBeTruthy()
  expect(payload.data.projectContext.activeProject.project.id).toBeTruthy()
  expect(payload.data.projectContext.activeProject.products.length).toBeGreaterThan(0)
  expect(payload.data.projectContext.activeProject.modules).toMatchObject({ feedbackEnabled: expect.any(Boolean) })
  expect(payload.data.workspace.stats).toMatchObject({
    totalFeedback: expect.any(Number),
    productCount: expect.any(Number),
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

  await sidebarLocator(page).locator('a[href="/feedback"]').click()
  await expect(page).toHaveURL(/\/feedback/)
  await expect(page.locator(selectors.navUserTrigger)).toBeVisible()
  await expect(page.locator(selectors.navUserLoading)).toHaveCount(0)

  await sidebarLocator(page).locator('a[href="/project/settings"]').click()
  await expect(page).toHaveURL(/\/project\/settings/)
  await expect(page.locator(selectors.navUserTrigger)).toBeVisible()
  await expect(page.locator(selectors.navUserLoading)).toHaveCount(0)
})

test('roadmap, changelog and support are hidden until switched on in project settings', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  await ensureProjectContext(page.request)
  const project = await createAndActivateProject(page.request, `E2E Tools ${Date.now()}`)

  try {
    await page.goto('/dashboard')
    const sidebar = sidebarLocator(page)

    // The sidebar is client-only: wait for it (and a stable entry) before asserting anything is absent.
    await expect(sidebar).toBeVisible()
    await expect(sidebar.locator('a[href="/feedback"]')).toBeVisible()
    await expect(sidebar.locator('a[href="/project/settings"]')).toBeVisible()

    // A new project only has Feedback on, so none of the other tools render anything.
    for (const href of ['/dashboard/roadmap', '/dashboard/changelog', '/support', '/support/contacts']) {
      await expect(sidebar.locator(`a[href="${href}"]`)).toHaveCount(0)
    }
    await expect(sidebar.getByTestId('sidebar-marketing-group')).toHaveCount(0)

    // A project admin gets an entry for adding the missing tools.
    await expect(sidebar.getByRole('link', { name: 'Add tool' })).toBeVisible()

    await page.goto('/project/settings?tab=tools')
    await expect(page.locator(projectSettingsTabSelector('tools'))).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('project-settings-lock')).toHaveCount(0)

    for (const [label, href] of [
      ['Roadmap', '/dashboard/roadmap'],
      ['Changelog', '/dashboard/changelog'],
      ['Support', '/support'],
    ] as const) {
      const toggle = page.getByRole('switch', { name: label, exact: true })
      await expect(toggle).toBeEnabled()
      await toggle.click()
      await expect(sidebar.locator(`a[href="${href}"]`)).toBeVisible({ timeout: 20_000 })
    }
    await expect(sidebar.locator('a[href="/support/contacts"]')).toBeVisible()

    // Switching one off again (with confirmation) hides it from the sidebar but keeps the others.
    await page.getByRole('switch', { name: 'Roadmap', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Disable' }).click()
    await expect(sidebar.locator('a[href="/dashboard/roadmap"]')).toHaveCount(0, { timeout: 20_000 })
    await expect(sidebar.locator('a[href="/dashboard/changelog"]')).toBeVisible()
  } finally {
    await deleteProjectViaApi(page.request, project.slug).catch(() => undefined)
  }
})

test('project members without admin rights see tools read-only and cannot add tools', async ({ browser, page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  await ensureProjectContext(page.request)
  const project = await createAndActivateProject(page.request, `E2E Readonly ${Date.now()}`)
  const memberUser = await createWorkspaceMember(page.request)
  const memberContext = await browser.newContext()

  try {
    const memberPage = await memberContext.newPage()
    await loginViaProgrammaticPage(memberPage, memberUser)
    await setActiveProject(memberPage.request, project.id)

    // A workspace-wide project gives every workspace member access, with the plain member role.
    const active = await getActiveProjectViaApi(memberPage.request)
    expect(active.id).toBe(project.id)
    expect(active.role).toBe('member')

    let putRequests = 0
    await memberPage.route(`**/api/projects/${project.slug}`, async (route) => {
      if (route.request().method() === 'PUT') putRequests += 1
      await route.continue()
    })

    await memberPage.goto('/project/settings?tab=tools')
    await expect(memberPage.locator(projectSettingsTabSelector('tools'))).toBeVisible({ timeout: 20_000 })
    await expect(memberPage.getByTestId('project-settings-lock')).toContainText('Project admins can change this')

    const supportSwitch = memberPage.getByRole('switch', { name: 'Support', exact: true })
    await expect(supportSwitch).toBeDisabled()
    await supportSwitch.click({ force: true })
    expect(putRequests).toBe(0)

    const memberSidebar = sidebarLocator(memberPage)
    await expect(memberSidebar.locator('a[href="/feedback"]')).toBeVisible()
    await expect(memberSidebar.getByRole('link', { name: 'Add tool' })).toHaveCount(0)

    // The server enforces the same rule.
    const forced = await memberPage.request.put(`/api/projects/${project.slug}`, {
      data: { settings: { supportEnabled: true } },
    })
    expect(forced.status()).toBe(403)
  } finally {
    await memberContext.close()
    await cleanupWorkspaceMember(memberUser)
    await deleteProjectViaApi(page.request, project.slug).catch(() => undefined)
  }
})

test('add tool shortcut is only offered to project admins', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })
  await ensureProjectContext(page.request)
  const project = await createAndActivateProject(page.request, `E2E Add Tool ${Date.now()}`)

  try {
    await page.goto('/dashboard')
    const addTool = sidebarLocator(page).getByRole('link', { name: 'Add tool' })
    await expect(addTool).toBeVisible({ timeout: 20_000 })
    await expect(addTool).toHaveAttribute('href', '/project/settings?tab=tools')
    await addTool.click()
    await expect(page).toHaveURL(/\/project\/settings\?tab=tools/)
    await expect(page.getByRole('switch', { name: 'Support', exact: true })).toBeVisible({ timeout: 20_000 })

    // With every tool switched on there is nothing left to add.
    const allOn = await page.request.put(`/api/projects/${project.slug}`, {
      data: {
        settings: {
          feedbackEnabled: true,
          roadmapEnabled: true,
          changelogEnabled: true,
          supportEnabled: true,
          marketingEnabled: true,
        },
      },
    })
    expect(allOn.ok()).toBeTruthy()
    await page.goto('/dashboard')
    await expect(sidebarLocator(page).locator('a[href="/support"]')).toBeVisible({ timeout: 20_000 })
    await expect(sidebarLocator(page).getByRole('link', { name: 'Add tool' })).toHaveCount(0)
  } finally {
    await deleteProjectViaApi(page.request, project.slug).catch(() => undefined)
  }
})
