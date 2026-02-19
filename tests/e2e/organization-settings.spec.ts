import { expect, test, type APIRequestContext } from '@playwright/test'
import { loginViaUi } from './helpers/auth'
import { selectors } from './helpers/selectors'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'
const TEMP_ORG_SLUG_PREFIX = 'org-e2e-'

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

test('owner can view, update, and delete organization from settings tab', async ({ page }) => {
  await loginViaUi(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

  await cleanupTemporaryOrganizations(page.request)

  const baseSlug = `org-e2e-${Date.now()}`
  const originalName = `Org E2E ${Date.now()}`
  await createOrganization(page.request, originalName, baseSlug)
  await expect
    .poll(
      async () => {
        const response = await page.request.get('/api/org-context/active-org')
        return response.status()
      },
      { timeout: 20_000 }
    )
    .toBe(200)

  await page.goto('/settings#organization')
  await page.waitForFunction(() => {
    const tab = document.querySelector('[data-testid="settings-tab-organization"]') as any
    return Boolean(tab?.__vueParentComponent)
  })

  await page.locator(selectors.settingsTabOrganization).click()
  await expect(page).toHaveURL(/#organization/)
  await expect(page.locator(selectors.organizationTitle)).toBeVisible()
  await expect(page.locator(selectors.organizationMembersCount)).toHaveText(/\d+\s+member(s)?/)
  await expect(page.locator('[data-testid="organization-member-role"]').first()).toHaveText(/owner|admin|member/i)

  const updatedName = `${originalName} Updated`
  const updatedSlug = `${baseSlug}-updated`

  await page.locator(selectors.organizationNameInput).fill(updatedName)
  await page.locator(selectors.organizationSlugInput).fill(updatedSlug)
  await page.locator(selectors.organizationLogoInput).fill('https://example.com/org-logo.png')
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

  const oldSlugResponse = await page.request.get(`/api/orgs/${baseSlug}`)
  expect(oldSlugResponse.status()).toBe(404)

  await page.locator(selectors.organizationNameInput).fill(originalName)
  await page.locator(selectors.organizationSlugInput).fill(baseSlug)
  await page.locator(selectors.organizationLogoInput).fill('')
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

  await page.locator(selectors.organizationOpenDeleteDialog).click()
  await expect(page.locator(selectors.organizationDeleteConfirmInput)).toBeVisible()
  await page.locator(selectors.organizationDeleteConfirmInput).fill(baseSlug)
  await page.locator(selectors.organizationDeleteSubmit).click()

  await expect(page).toHaveURL(/#team/)

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
        const response = await page.request.get('/api/teams/active')
        return response.status()
      },
      { timeout: 20_000 }
    )
    .toBe(200)
})

test('owner can add billing contact emails for receipt copy', async ({ page }) => {
  await loginViaUi(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

  await cleanupTemporaryOrganizations(page.request)

  const orgSlug = `org-e2e-billing-${Date.now()}`
  await createOrganization(page.request, `Org Billing ${Date.now()}`, orgSlug)

  try {
    await expect
      .poll(
        async () => {
          const response = await page.request.get('/api/org-context/active-org')
          return response.status()
        },
        { timeout: 20_000 }
      )
      .toBe(200)

    await page.goto('/settings#billing')
    await page.waitForFunction(() => {
      const tab = document.querySelector('[data-testid="settings-tab-billing"]') as any
      return Boolean(tab?.__vueParentComponent)
    })

    await page.locator(selectors.settingsTabBilling).click()
    await expect(page).toHaveURL(/#billing/)
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
  } finally {
    await deleteOrganizationIfExists(page.request, orgSlug)
  }
})
