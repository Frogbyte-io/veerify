import { expect, test, type APIRequestContext } from '@playwright/test'
import { loginViaProgrammaticPage, withOriginHeaders } from './helpers/auth'
import { selectors, workspaceTabSelector } from './helpers/selectors'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'
const TEMP_ORG_SLUG_PREFIX = 'org-e2e-'
const deploymentMode = process.env.APP_DEPLOYMENT_MODE || 'self-hosted'

test.setTimeout(60_000)

async function createOrganization(request: APIRequestContext, name: string, slug: string) {
  const response = await request.post('/api/orgs', {
    data: {
      name,
      slug,
      logo: null,
    },
  })
  const payload = await response.json().catch(() => ({}))
  expect(response.status()).toBe(201)
  expect(payload?.success).toBeTruthy()
  expect(payload?.data?.slug).toBe(slug)
  return payload.data
}

/**
 * Makes the new workspace the active one (also for Better-Auth's cached session) and gives it a first
 * project, which a workspace needs before the app treats it as usable. Verifies the switch took effect so
 * the tests below can never edit or delete the seeded workspace by accident.
 */
async function activateOrganizationWithProject(request: APIRequestContext, organization: { id: string; slug: string }) {
  const setActive = await request.post('/api/auth/organization/set-active', {
    headers: withOriginHeaders('/workspace'),
    data: { organizationId: organization.id },
  })
  expect(setActive.ok()).toBeTruthy()

  await expect
    .poll(
      async () => {
        const response = await request.get('/api/auth/organization/get-full-organization')
        const payload = await response.json().catch(() => null)
        return payload?.slug || null
      },
      { timeout: 20_000 }
    )
    .toBe(organization.slug)

  const project = await request.post('/api/projects', { data: { name: `Project ${organization.slug}` } })
  expect(project.status()).toBe(201)
  const projectId = (await project.json()).data.project.id as string
  const activate = await request.post('/api/projects/active', { data: { projectId } })
  expect(activate.ok()).toBeTruthy()
}

function parseOrganizations(payload: any): Array<{ id: string; name: string; slug?: string | null }> {
  if (Array.isArray(payload)) {
    return payload
  }
  if (Array.isArray(payload?.data)) {
    return payload.data
  }
  return []
}

async function listOrganizations(request: APIRequestContext) {
  const response = await request.get('/api/auth/organization/list')
  expect(response.ok()).toBeTruthy()
  const payload = await response.json().catch(() => ({}))
  return parseOrganizations(payload)
}

async function deleteOrganizationIfExists(request: APIRequestContext, slug: string) {
  const response = await request.delete(`/api/orgs/${slug}`, {
    data: {
      confirmSlug: slug,
    },
  })

  if (response.status() === 404) {
    return
  }

  expect(response.ok()).toBeTruthy()
}

async function cleanupTemporaryOrganizations(request: APIRequestContext) {
  const organizations = await listOrganizations(request)
  const temporarySlugs = organizations
    .map((organization) => organization.slug || '')
    .filter((slug) => slug.startsWith(TEMP_ORG_SLUG_PREFIX))

  for (const slug of temporarySlugs) {
    await deleteOrganizationIfExists(request, slug)
  }
}

test('owner can view, update, and delete the workspace from workspace settings', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

  await cleanupTemporaryOrganizations(page.request)

  const baseSlug = `org-e2e-${Date.now()}`
  const originalName = `Org E2E ${Date.now()}`
  const created = await createOrganization(page.request, originalName, baseSlug)
  await activateOrganizationWithProject(page.request, created)

  await page.goto('/workspace')
  await expect(page.getByTestId('workspace-page')).toHaveAttribute('data-hydrated', 'true')
  await expect(page.locator(workspaceTabSelector('general'))).toBeVisible({ timeout: 20_000 })

  await page.locator(workspaceTabSelector('general')).click()
  await expect(page).toHaveURL(/tab=general/)
  await expect(page.locator(selectors.organizationTitle)).toBeVisible()

  await page.locator(workspaceTabSelector('members')).click()
  await expect(page).toHaveURL(/tab=members/)
  await expect(page.locator(selectors.organizationMembersCount)).toHaveText(/\d+\s+member(s)?/)
  await expect(page.locator('[data-testid="organization-member-role"]').first()).toHaveText(/owner|admin|member/i)

  await page.locator(workspaceTabSelector('general')).click()
  await expect(page).toHaveURL(/tab=general/)

  const updatedName = `${originalName} Updated`
  const updatedSlug = `${baseSlug}-updated`
  const logoPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2m7w0AAAAASUVORK5CYII='

  // Safety net: only ever edit the temporary workspace, never the seeded one.
  await expect(page.locator(selectors.organizationNameInput)).toHaveValue(originalName)
  await page.locator(selectors.organizationNameInput).fill(updatedName)
  await page.locator(selectors.organizationSlugInput).fill(updatedSlug)
  await page.locator(selectors.organizationLogoUploadInput).setInputFiles({
    name: 'workspace-logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(logoPngBase64, 'base64'),
  })
  await page.locator(selectors.organizationSave).click()

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/orgs/${updatedSlug}`)
        if (!response.ok()) return null
        const payload = await response.json()
        return payload?.data?.name || null
      },
      { timeout: 20_000 }
    )
    .toBe(updatedName)

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/orgs/${updatedSlug}`)
        if (!response.ok()) return null
        const payload = await response.json()
        return payload?.data?.logo || null
      },
      { timeout: 20_000 }
    )
    .toMatch(/(\/api\/uploads\/object\/|https?:\/\/)/)

  const oldSlugResponse = await page.request.get(`/api/orgs/${baseSlug}`)
  expect(oldSlugResponse.status()).toBe(404)

  await page.locator(selectors.organizationNameInput).fill(originalName)
  await page.locator(selectors.organizationSlugInput).fill(baseSlug)
  await expect(page.locator(selectors.organizationLogoRemove)).toBeVisible()
  await page.locator(selectors.organizationLogoRemove).click()
  await page.locator(selectors.organizationSave).click()

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/orgs/${baseSlug}`)
        if (!response.ok()) return null
        const payload = await response.json()
        return payload?.data?.slug || null
      },
      { timeout: 20_000 }
    )
    .toBe(baseSlug)

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/orgs/${baseSlug}`)
        if (!response.ok()) return null
        const payload = await response.json()
        return payload?.data?.logo ?? null
      },
      { timeout: 20_000 }
    )
    .toBeNull()

  await page.locator(selectors.organizationOpenDeleteDialog).click()
  await expect(page.locator(selectors.organizationDeleteConfirmInput)).toBeVisible()
  await page.locator(selectors.organizationDeleteConfirmInput).fill(baseSlug)
  await page.locator(selectors.organizationDeleteSubmit).click()

  // The owner still has the seeded workspace, so deleting this one lands them back in a project.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/orgs/${baseSlug}`)
        return response.status()
      },
      { timeout: 20_000 }
    )
    .toBe(404)

  await expect
    .poll(
      async () => {
        const response = await page.request.get('/api/projects/active')
        return response.status()
      },
      { timeout: 20_000 }
    )
    .toBe(200)
})

test('owner can add billing contact emails for receipt copy', async ({ page }) => {
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

  await cleanupTemporaryOrganizations(page.request)

  const orgSlug = `org-e2e-billing-${Date.now()}`
  const created = await createOrganization(page.request, `Org Billing ${Date.now()}`, orgSlug)

  try {
    await activateOrganizationWithProject(page.request, created)

    if (deploymentMode === 'self-hosted') {
      await page.goto('/workspace#status')
      await expect(page.getByTestId('workspace-page')).toHaveAttribute('data-hydrated', 'true')
      await expect(page.locator(workspaceTabSelector('status'))).toBeVisible({ timeout: 20_000 })

      await page.locator(workspaceTabSelector('status')).click()
      await expect(page).toHaveURL(/tab=status/)
      await expect(page.locator(selectors.settingsStatusPanel)).toBeVisible()
      await expect(page.locator(selectors.statusServiceDatabase)).toBeVisible()
      await expect(page.locator(selectors.statusServiceStorage)).toBeVisible()
      await expect(page.locator(selectors.statusServiceEmail)).toBeVisible()
    } else {
      await page.goto('/workspace#billing')
      await expect(page.getByTestId('workspace-page')).toHaveAttribute('data-hydrated', 'true')
      await expect(page.locator(workspaceTabSelector('billing'))).toBeVisible({ timeout: 20_000 })

      await page.locator(workspaceTabSelector('billing')).click()
      await expect(page).toHaveURL(/tab=billing/)
      await expect(page.locator(selectors.settingsBillingPanel)).toBeVisible()

      const contactEmail = `billing-${Date.now()}@example.com`
      const normalizedEmail = contactEmail.toLowerCase()

      await page.locator(selectors.billingContactsInput).fill(contactEmail)
      await page.locator(selectors.billingContactsAdd).click()
      await expect(page.locator(selectors.billingContactItem).filter({ hasText: normalizedEmail })).toBeVisible()

      await page.locator(selectors.billingContactsSave).click()

      await expect
        .poll(
          async () => {
            const response = await page.request.get(`/api/orgs/${orgSlug}`)
            if (!response.ok()) return []
            const payload = await response.json()
            return payload?.data?.settings?.billingCcEmails || []
          },
          { timeout: 20_000 }
        )
        .toEqual(expect.arrayContaining([normalizedEmail]))
    }
  } finally {
    await deleteOrganizationIfExists(page.request, orgSlug)
  }
})
