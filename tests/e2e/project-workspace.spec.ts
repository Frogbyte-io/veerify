import { expect, test, type APIRequestContext } from '@playwright/test'
import { isBetterAuthCookie, loginViaProgrammatic, signInAndGetSessionCookie, withAuthHeaders } from './helpers/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'
const ORG_SLUG = process.env.E2E_ORG_SLUG || 'preview-org'
const PORT = process.env.PLAYWRIGHT_PORT || '4173'

test.setTimeout(60_000)

async function activateProject(request: APIRequestContext, slug: string) {
  const projectResponse = await request.get(`/api/projects/${slug}`)
  expect(projectResponse.ok()).toBeTruthy()
  const projectId = (await projectResponse.json())?.data?.id as string
  const activeResponse = await request.post('/api/projects/active', { data: { projectId } })
  expect(activeResponse.ok()).toBeTruthy()
}

/** Creates a project (with its default product) in the active workspace and makes it the active project. */
async function createActiveProject(
  request: APIRequestContext,
  input: { name: string; slug: string; description?: string | null }
) {
  const createResponse = await request.post('/api/projects', {
    data: { ...input, description: input.description ?? null },
  })
  const createPayload = await createResponse.json()
  expect(createResponse.status(), JSON.stringify(createPayload)).toBe(201)
  const project = createPayload.data.project as { id: string; slug: string }

  const activeResponse = await request.post('/api/projects/active', { data: { projectId: project.id } })
  expect(activeResponse.ok()).toBeTruthy()
  return { project, product: createPayload.data.product as { id: string; slug: string } }
}

test('project API flow persists custom domains and enforces URL conflicts', async ({ request, page }) => {
  const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const uniqueSlug = `e2e-project-${Date.now()}`
  const customDomain = `${uniqueSlug}.customer.localhost`

  const createResponse = await request.post('/api/projects', {
    headers: withAuthHeaders(sessionCookie),
    data: {
      name: 'E2E Project',
      slug: uniqueSlug,
      description: 'Created by Playwright API test',
    },
  })
  const createPayload = await createResponse.json()
  expect(createResponse.status()).toBe(201)
  expect(createPayload?.success).toBeTruthy()
  expect(createPayload?.data?.project?.slug).toBe(uniqueSlug)
  // Every project is created with one default product sharing its name and slug.
  expect(createPayload?.data?.product?.slug).toBe(uniqueSlug)

  try {
    const setDomainResponse = await request.put(`/api/projects/${uniqueSlug}`, {
      headers: withAuthHeaders(sessionCookie),
      data: { customDomain },
    })
    expect(setDomainResponse.ok(), await setDomainResponse.text()).toBeTruthy()
    const setDomainPayload = await setDomainResponse.json()
    expect(setDomainPayload?.data?.customDomain).toBe(customDomain)

    await page.goto(`http://${customDomain}:${PORT}`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
    await expect(page.getByRole('heading', { name: 'E2E Project' })).toBeVisible()

    // Public contract is orgSlug + projectSlug.
    const publicProjectResponse = await request.get(`/api/public/o/${ORG_SLUG}/${uniqueSlug}`)
    const publicProjectPayload = await publicProjectResponse.json()
    expect(publicProjectResponse.ok()).toBeTruthy()
    expect(publicProjectPayload?.data?.project?.slug).toBe(uniqueSlug)
    expect(publicProjectPayload?.data?.organization?.slug).toBe(ORG_SLUG)
    expect(publicProjectPayload?.data?.products).toHaveLength(1)

    const duplicateResponse = await request.post('/api/projects', {
      headers: withAuthHeaders(sessionCookie),
      data: {
        name: 'E2E Project Duplicate',
        slug: uniqueSlug,
        description: null,
      },
    })
    const duplicatePayload = await duplicateResponse.json().catch(() => ({}))
    expect(duplicateResponse.status()).toBe(409)
    const duplicateMessage = String(
      duplicatePayload?.error?.message ||
        duplicatePayload?.message ||
        duplicatePayload?.data?.message ||
        duplicatePayload?.statusMessage ||
        JSON.stringify(duplicatePayload)
    )
    expect(duplicateMessage).toMatch(/workspace|URL|conflict|taken|exists/i)

    const otherSlug = `${uniqueSlug}-domain-conflict`
    const otherResponse = await request.post('/api/projects', {
      headers: withAuthHeaders(sessionCookie),
      data: { name: 'E2E Duplicate Domain Project', slug: otherSlug, description: null },
    })
    expect(otherResponse.status()).toBe(201)
    try {
      const duplicateDomainResponse = await request.put(`/api/projects/${otherSlug}`, {
        headers: withAuthHeaders(sessionCookie),
        data: { customDomain },
      })
      expect(duplicateDomainResponse.status()).toBe(409)
    } finally {
      await request.delete(`/api/projects/${otherSlug}`, { headers: withAuthHeaders(sessionCookie) })
    }
  } finally {
    await request.delete(`/api/projects/${uniqueSlug}`, { headers: withAuthHeaders(sessionCookie) })
  }
})

test('authenticated user can open project settings and switch tabs', async ({ request, page }) => {
  await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
  const authCookies = (await request.storageState()).cookies.filter((cookie) => isBetterAuthCookie(cookie.name))
  expect(authCookies.length).toBeGreaterThan(0)
  await page.context().addCookies(authCookies)

  const slug = `e2e-settings-${Date.now()}`
  await createActiveProject(request, { name: 'Settings Tabs Project', slug })

  try {
    await page.goto('/project/settings', { waitUntil: 'commit', timeout: 180_000 })
    await expect(page).toHaveURL(/\/project\/settings/)
    await expect(page.getByRole('heading', { name: 'Project settings' })).toBeVisible()
    await expect(page.getByText('Settings Tabs Project').first()).toBeVisible()

    for (const tab of ['general', 'products', 'access', 'tools', 'appearance', 'domain', 'embed']) {
      await expect(page.locator(`[data-testid="project-settings-tab-${tab}"]`)).toBeVisible()
    }
    // Teams are gone; there is no team tab.
    await expect(page.locator('[data-testid="project-settings-tab-team"]')).toHaveCount(0)

    // General does not host domain settings; those live in the Domain tab.
    await expect(page.locator('label[for="project-domain"]')).toHaveCount(0)

    await page.locator('[data-testid="project-settings-tab-domain"]').click()
    await expect(page).toHaveURL(/\/project\/settings#domain$/)
    await expect(page.locator('#custom-domain')).toBeVisible()

    await page.locator('[data-testid="project-settings-tab-products"]').click()
    await expect(page).toHaveURL(/\/project\/settings#products$/)
    await expect(page.getByText('Settings Tabs Project').first()).toBeVisible()
  } finally {
    await request.delete(`/api/projects/${slug}`)
  }
})

test('new project statuses tab shows the default starting workflow without declined or drag affordances', async ({
  request,
  page,
}) => {
  await loginViaProgrammatic(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const authCookies = (await request.storageState()).cookies.filter((cookie) => isBetterAuthCookie(cookie.name))
  expect(authCookies.length).toBeGreaterThan(0)
  await page.context().addCookies(authCookies)

  const projectSlug = `e2e-statuses-${Date.now()}`
  const createProjectResponse = await request.post('/api/projects', {
    data: {
      name: 'Statuses Project',
      slug: projectSlug,
      description: null,
    },
  })
  expect(createProjectResponse.status()).toBe(201)

  const statusesResponse = await request.get(`/api/projects/${projectSlug}/statuses`)
  const statusesPayload = await statusesResponse.json()
  expect(statusesResponse.ok()).toBeTruthy()
  const initialStatuses = statusesPayload.data as Array<{ name: string; value: string }>
  expect(initialStatuses.map((status) => status.name)).toEqual([
    'Open',
    'Planned',
    'In Progress',
    'Completed',
    'Closed',
  ])
  expect(initialStatuses.map((status) => status.value)).not.toContain('declined')

  await activateProject(request, projectSlug)
  await page.goto(`/feedback?view=settings&section=statuses`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await expect(page).toHaveURL(/section=statuses/)
  await expect(page.getByRole('heading', { name: 'Feedback Statuses' })).toBeVisible()
  await expect(
    page.getByText(
      'Review the default starting workflow for feedback items. Add a custom status to start customizing it.'
    )
  ).toBeVisible()
  await expect(
    page.getByText('Using the default starting workflow. Add a custom status to replace it with your own workflow.')
  ).toBeVisible()

  for (const label of ['Open', 'Planned', 'In Progress', 'Completed', 'Closed']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible()
  }
  await expect(page.getByText('Declined', { exact: true })).toHaveCount(0)
  await expect(page.locator('[data-testid^="product-status-drag-handle-"]')).toHaveCount(0)
})

test('feedback settings categories tab reorders categories through drag and drop and persists the new order', async ({
  request,
  page,
}) => {
  await loginViaProgrammatic(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const authCookies = (await request.storageState()).cookies.filter((cookie) => isBetterAuthCookie(cookie.name))
  expect(authCookies.length).toBeGreaterThan(0)
  await page.context().addCookies(authCookies)

  const projectSlug = `e2e-categories-ui-${Date.now()}`
  const createProjectResponse = await request.post('/api/projects', {
    data: {
      name: 'Categories UI Project',
      slug: projectSlug,
      description: null,
    },
  })
  expect(createProjectResponse.status()).toBe(201)

  const categoriesResponse = await request.get(`/api/projects/${projectSlug}/categories`)
  const categoriesPayload = await categoriesResponse.json()
  expect(categoriesResponse.ok()).toBeTruthy()
  const initialCategories = categoriesPayload.data as Array<{ id: string; name: string }>
  expect(initialCategories.map((category) => category.name)).toEqual(['Bug', 'Feature'])

  const bugCategory = initialCategories.find((category) => category.name === 'Bug')
  const featureCategory = initialCategories.find((category) => category.name === 'Feature')
  expect(bugCategory?.id).toBeTruthy()
  expect(featureCategory?.id).toBeTruthy()

  await activateProject(request, projectSlug)
  await page.goto(`/feedback?view=settings&section=categories`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await expect(page).toHaveURL(/section=categories/)
  await expect(page.getByRole('heading', { name: 'Feedback Categories' })).toBeVisible()
  await expect(page.locator('[data-testid^="product-category-item-"]')).toHaveCount(2)

  const readUiOrder = async () =>
    page
      .locator('[data-testid^="product-category-item-"]')
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-testid')?.replace('product-category-item-', '') || '')
      )

  await expect.poll(readUiOrder).toEqual([bugCategory!.id, featureCategory!.id])

  const sourceHandle = page.locator(`[data-testid="product-category-drag-handle-${bugCategory!.id}"]`)
  const targetItem = page.locator(`[data-testid="product-category-item-${featureCategory!.id}"]`)
  const sourceBox = await sourceHandle.boundingBox()
  const targetBox = await targetItem.boundingBox()
  expect(sourceBox).toBeTruthy()
  expect(targetBox).toBeTruthy()

  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height - 6, { steps: 20 })
  await page.mouse.up()

  await expect.poll(readUiOrder).toEqual([featureCategory!.id, bugCategory!.id])
  await expect(page.getByText('Category order saved')).toBeVisible()

  await expect
    .poll(async () => {
      const response = await request.get(`/api/projects/${projectSlug}/categories`)
      const payload = await response.json()
      return (payload.data as Array<{ name: string }>).map((category) => category.name)
    })
    .toEqual(['Feature', 'Bug'])
})

test('custom domain dns setup hides duplicate cname targets for the same host', async ({ request, page }) => {
  await loginViaProgrammatic(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const authCookies = (await request.storageState()).cookies.filter((cookie) => isBetterAuthCookie(cookie.name))
  expect(authCookies.length).toBeGreaterThan(0)
  await page.context().addCookies(authCookies)

  const projectSlug = `e2e-domain-${Date.now()}`
  const createProjectResponse = await request.post('/api/projects', {
    data: {
      name: 'Domain Project',
      slug: projectSlug,
      description: null,
    },
  })
  expect(createProjectResponse.status()).toBe(201)

  await page.route(`**/api/projects/${projectSlug}/verify-domain?**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        hostname: 'feedback.example.com',
        provider: 'cloudflare-saas',
        verified: false,
        status: 'ownership_verification_required',
        dnsRecords: [
          {
            type: 'TXT',
            name: '_acme-challenge.feedback.example.com',
            value: 'e2e-token-value',
          },
          {
            type: 'CNAME',
            name: 'feedback.example.com',
            value: 'abc123.edge.example.net.',
          },
          {
            type: 'CNAME',
            name: 'feedback.example.com',
            value: 'cname.edge.example.net.',
          },
        ],
        configuredBy: 'CNAME',
        expected: 'abc123.edge.example.net.',
        resolvedTo: [],
        message: null,
      }),
    })
  })

  await activateProject(request, projectSlug)
  await page.goto(`/project/settings#domain`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await expect(page).toHaveURL(/\/project\/settings#domain$/)
  await expect(page.getByText('Required DNS records', { exact: true })).toBeVisible()

  await page.locator('#custom-domain').fill('feedback.example.com')
  await page.getByRole('button', { name: 'Check DNS' }).click()

  await expect(page.getByText('e2e-token-value')).toBeVisible()
  await expect(page.getByText('abc123.edge.example.net.').last()).toBeVisible()
  await expect(page.getByText('cname.edge.example.net.')).toHaveCount(0)
  await expect(page.getByText(/Last checked/)).toBeVisible()
})

test('custom domain status downgrades from stored verified state after a failed dns check', async ({
  request,
  page,
}) => {
  await loginViaProgrammatic(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const authCookies = (await request.storageState()).cookies.filter((cookie) => isBetterAuthCookie(cookie.name))
  expect(authCookies.length).toBeGreaterThan(0)
  await page.context().addCookies(authCookies)

  const projectSlug = `e2e-domain-status-${Date.now()}`
  const createProjectResponse = await request.post('/api/projects', {
    data: {
      name: 'Domain Status Project',
      slug: projectSlug,
      description: null,
    },
  })
  expect(createProjectResponse.status()).toBe(201)

  const saveDomainResponse = await request.put(`/api/projects/${projectSlug}`, {
    data: {
      customDomain: 'feedback.example.com',
    },
  })
  expect(saveDomainResponse.ok()).toBeTruthy()

  await page.route(`**/api/projects/${projectSlug}`, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }

    const response = await page.request.fetch(route.request())
    const payload = await response.json()

    await route.fulfill({
      status: response.status(),
      contentType: 'application/json',
      body: JSON.stringify({
        ...payload,
        data: {
          ...payload.data,
          settings: {
            ...(payload.data?.settings || {}),
            domainStatus: 'active',
          },
        },
      }),
    })
  })

  await page.route(`**/api/projects/${projectSlug}/verify-domain?**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        hostname: 'feedback.example.com',
        provider: 'static-cname',
        verified: false,
        status: 'dns_required',
        dnsRecords: [
          {
            type: 'CNAME',
            name: 'feedback.example.com',
            value: 'cname.veerify.com',
          },
        ],
        configuredBy: 'CNAME',
        expected: 'cname.veerify.com',
        resolvedTo: [],
        message: null,
      }),
    })
  })

  await activateProject(request, projectSlug)
  await page.goto(`/project/settings#domain`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await expect(page).toHaveURL(/\/project\/settings#domain$/)
  await expect(page.getByTestId('product-domain-status-title')).toHaveText('Domain verified')

  await page.getByRole('button', { name: 'Check DNS' }).click()

  await expect(page.getByTestId('product-domain-status-title')).toHaveText('DNS configuration incomplete')
  await expect(page.getByTestId('product-domain-status-hint')).toHaveText(
    'The domain is added, but the latest DNS check did not find the required records.'
  )
  await expect(page.getByText('No matching DNS records found for')).toBeVisible()

  await page.unroute(`**/api/projects/${projectSlug}/verify-domain?**`)
  await page.route(`**/api/projects/${projectSlug}/verify-domain?**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        hostname: 'feedback.example.com',
        provider: 'static-cname',
        verified: false,
        status: 'error',
        dnsRecords: [],
        configuredBy: null,
        expected: null,
        resolvedTo: [],
        message: 'Domain provider unavailable',
      }),
    })
  })

  await page.getByRole('button', { name: 'Check DNS' }).click()
  await expect(page.getByTestId('product-domain-status-title')).toHaveText('Domain connection error')
  await expect(page.getByText('Domain provider unavailable')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible()
  await page.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0)
})

test('project categories API supports create/update/reorder/delete with reassignment rules', async ({ request }) => {
  const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const projectSlug = `e2e-cats-${Date.now()}`
  const createProjectResponse = await request.post('/api/projects', {
    headers: withAuthHeaders(sessionCookie),
    data: {
      name: 'Categories Project',
      slug: projectSlug,
      description: null,
    },
  })
  expect(createProjectResponse.status()).toBe(201)
  const createProjectPayload = await createProjectResponse.json()
  const projectId = createProjectPayload?.data?.project?.id as string

  const listDefaultsResponse = await request.get(`/api/projects/${projectSlug}/categories`, {
    headers: withAuthHeaders(sessionCookie),
  })
  const listDefaultsPayload = await listDefaultsResponse.json()
  expect(listDefaultsResponse.ok()).toBeTruthy()
  const defaults = listDefaultsPayload.data as Array<{ id: string; name: string; slug: string }>
  expect(defaults.map((c) => c.name)).toEqual(['Bug', 'Feature'])

  const createCategoryResponse = await request.post(`/api/projects/${projectSlug}/categories`, {
    headers: withAuthHeaders(sessionCookie),
    data: {
      name: 'UX',
      icon: '🎨',
      color: '#7c3aed',
      description: 'Interface and usability feedback',
    },
  })
  const createCategoryPayload = await createCategoryResponse.json()
  expect(createCategoryResponse.status()).toBe(201)
  const customCategoryId = createCategoryPayload.data.id as string

  const updateCategoryResponse = await request.put(`/api/projects/${projectSlug}/categories/${customCategoryId}`, {
    headers: withAuthHeaders(sessionCookie),
    data: {
      name: 'User Experience',
      color: '#9333ea',
    },
  })
  const updateCategoryPayload = await updateCategoryResponse.json()
  expect(updateCategoryResponse.ok()).toBeTruthy()
  expect(updateCategoryPayload.data.name).toBe('User Experience')

  const bugCategory = defaults.find((category) => category.slug === 'bug')
  expect(bugCategory?.id).toBeTruthy()
  if (!bugCategory) throw new Error('Expected default bug category to exist')

  const featureCategory = defaults.find((category) => category.slug === 'feature')
  expect(featureCategory?.id).toBeTruthy()
  if (!featureCategory) throw new Error('Expected default feature category to exist')

  const reorderedCategoryIds = [customCategoryId, bugCategory.id, featureCategory.id]
  for (const [sortOrder, categoryId] of reorderedCategoryIds.entries()) {
    const reorderResponse = await request.put(`/api/projects/${projectSlug}/categories/${categoryId}`, {
      headers: withAuthHeaders(sessionCookie),
      data: { sortOrder },
    })
    expect(reorderResponse.ok()).toBeTruthy()
  }

  const listAfterReorderResponse = await request.get(`/api/projects/${projectSlug}/categories`, {
    headers: withAuthHeaders(sessionCookie),
  })
  const listAfterReorderPayload = await listAfterReorderResponse.json()
  expect(listAfterReorderResponse.ok()).toBeTruthy()
  const categoriesAfterReorder = listAfterReorderPayload.data as Array<{ name: string }>
  expect(categoriesAfterReorder.map((category) => category.name)).toEqual(['User Experience', 'Bug', 'Feature'])

  const publicProjectResponse = await request.get(`/api/public/o/${ORG_SLUG}/${projectSlug}`)
  const publicProjectPayload = await publicProjectResponse.json()
  expect(publicProjectResponse.ok()).toBeTruthy()
  const publicCategoryNames = (publicProjectPayload?.data?.categories ?? []).map(
    (category: { name: string }) => category.name
  )
  expect(publicCategoryNames).toEqual(['User Experience', 'Bug', 'Feature'])

  const createFeedbackResponse = await request.post('/api/feedback', {
    headers: withAuthHeaders(sessionCookie, '/feedback'),
    data: {
      title: 'Navigation feels confusing',
      body: 'Users cannot find settings quickly',
      projectId,
      categoryId: customCategoryId,
    },
  })
  const createFeedbackPayload = await createFeedbackResponse.json()
  expect(createFeedbackResponse.status()).toBe(201)
  expect(createFeedbackPayload?.data?.categoryId).toBe(customCategoryId)

  const deleteWithoutReplacement = await request.delete(`/api/projects/${projectSlug}/categories/${customCategoryId}`, {
    headers: withAuthHeaders(sessionCookie),
    data: {},
  })
  expect(deleteWithoutReplacement.status()).toBe(409)

  const deleteWithReplacement = await request.delete(`/api/projects/${projectSlug}/categories/${customCategoryId}`, {
    headers: withAuthHeaders(sessionCookie),
    data: {
      replacementCategoryId: bugCategory.id,
    },
  })
  expect(deleteWithReplacement.ok()).toBeTruthy()

  const deleteDefault = await request.delete(`/api/projects/${projectSlug}/categories/${bugCategory.id}`, {
    headers: withAuthHeaders(sessionCookie),
    data: {},
  })
  expect(deleteDefault.status()).toBe(403)
})
