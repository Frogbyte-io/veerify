import { expect, test } from '@playwright/test'
import { loginViaProgrammatic, signInAndGetSessionCookie, withAuthHeaders } from './helpers/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'
const TEAM_SLUG = process.env.E2E_TEAM_SLUG || 'preview-org'

test.setTimeout(60_000)

test('team-primary API flow keeps public URL orgSlug + projectSlug and enforces duplicate slug conflict', async ({
  request,
}) => {
  const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const activeTeamResponse = await request.get('/api/teams/active', {
    headers: withAuthHeaders(sessionCookie),
  })
  const activeTeamPayload = await activeTeamResponse.json()
  expect(activeTeamResponse.ok()).toBeTruthy()
  expect(activeTeamPayload?.success).toBeTruthy()
  expect(activeTeamPayload?.data?.id).toBeTruthy()
  const teamId = activeTeamPayload.data.id as string

  const uniqueSlug = `e2e-team-${Date.now()}`

  const createResponse = await request.post(`/api/teams/${teamId}/projects`, {
    headers: withAuthHeaders(sessionCookie),
    data: {
      name: 'E2E Team Product',
      slug: uniqueSlug,
      description: 'Created by Playwright API test',
      customDomain: null,
    },
  })
  const createPayload = await createResponse.json()
  expect(createResponse.status()).toBe(201)
  expect(createPayload?.success).toBeTruthy()
  expect(createPayload?.data?.slug).toBe(uniqueSlug)

  // Public contract stays orgSlug + projectSlug; team ownership is internal.
  const publicProjectResponse = await request.get(`/api/public/t/${TEAM_SLUG}/${uniqueSlug}`)
  const publicProjectPayload = await publicProjectResponse.json()
  expect(publicProjectResponse.ok()).toBeTruthy()
  expect(publicProjectPayload?.data?.project?.slug).toBe(uniqueSlug)
  expect(publicProjectPayload?.data?.team?.slug).toBe(TEAM_SLUG)

  const duplicateResponse = await request.post(`/api/teams/${teamId}/projects`, {
    headers: withAuthHeaders(sessionCookie),
    data: {
      name: 'E2E Team Product Duplicate',
      slug: uniqueSlug,
      description: null,
      customDomain: null,
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
  expect(duplicateMessage).toMatch(/workspace URL namespace|conflict/i)
})

test('authenticated user can access products UI workflow', async ({ request, page }) => {
  await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
  const authCookies = (await request.storageState()).cookies.filter((cookie) => cookie.name.startsWith('better-auth'))
  expect(authCookies.length).toBeGreaterThan(0)
  await page.context().addCookies(authCookies)

  await page.goto('/products', { waitUntil: 'commit', timeout: 180_000 })
  await expect(page).toHaveURL(/\/products/)
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New Product' })).toBeVisible()
  await expect(page.getByText('Manage your products and their public feedback pages')).toBeVisible()
  await expect(page.getByText('Custom Domain (optional)')).toHaveCount(0)
  await expect(page.getByText('Point a CNAME record to veerify to use a custom domain.')).toHaveCount(0)

  const firstProductLink = page.locator('a[href^="/products/"]').first()
  await expect(firstProductLink).toBeVisible()
  await firstProductLink.click()
  await expect(page).toHaveURL(/\/products\/[^/]+/)
  await expect(page.getByText('General Settings')).toBeVisible()
  await expect(page.locator('label[for="project-domain"]')).toHaveCount(0)
  await expect(page.getByText('Point a CNAME record to Veerify to use a custom domain.')).toHaveCount(0)
})

test('new project statuses tab shows the default starting workflow without declined or drag affordances', async ({
  request,
  page,
}) => {
  await loginViaProgrammatic(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const authCookies = (await request.storageState()).cookies.filter((cookie) => cookie.name.startsWith('better-auth'))
  expect(authCookies.length).toBeGreaterThan(0)
  await page.context().addCookies(authCookies)

  const activeTeamResponse = await request.get('/api/teams/active')
  const activeTeamPayload = await activeTeamResponse.json()
  expect(activeTeamResponse.ok()).toBeTruthy()
  const teamId = activeTeamPayload.data.id as string

  const projectSlug = `e2e-statuses-${Date.now()}`
  const createProjectResponse = await request.post(`/api/teams/${teamId}/projects`, {
    data: {
      name: 'Statuses Product',
      slug: projectSlug,
      description: null,
      customDomain: null,
    },
  })
  expect(createProjectResponse.status()).toBe(201)

  const statusesResponse = await request.get(`/api/projects/${projectSlug}/statuses`)
  const statusesPayload = await statusesResponse.json()
  expect(statusesResponse.ok()).toBeTruthy()
  const initialStatuses = statusesPayload.data as Array<{ name: string; value: string }>
  expect(initialStatuses.map((status) => status.name)).toEqual(['Open', 'Planned', 'In Progress', 'Completed', 'Closed'])
  expect(initialStatuses.map((status) => status.value)).not.toContain('declined')

  await page.goto(`/products/${projectSlug}#statuses`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await expect(page).toHaveURL(new RegExp(`/products/${projectSlug}#statuses$`))
  await expect(page.getByText('Feedback Statuses')).toBeVisible()
  await expect(
    page.getByText('Review the default starting workflow for feedback items. Add a custom status to start customizing it.')
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

test('product categories tab reorders categories through drag and drop and persists the new order', async ({
  request,
  page,
}) => {
  await loginViaProgrammatic(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const authCookies = (await request.storageState()).cookies.filter((cookie) => cookie.name.startsWith('better-auth'))
  expect(authCookies.length).toBeGreaterThan(0)
  await page.context().addCookies(authCookies)

  const activeTeamResponse = await request.get('/api/teams/active')
  const activeTeamPayload = await activeTeamResponse.json()
  expect(activeTeamResponse.ok()).toBeTruthy()
  const teamId = activeTeamPayload.data.id as string

  const projectSlug = `e2e-categories-ui-${Date.now()}`
  const createProjectResponse = await request.post(`/api/teams/${teamId}/projects`, {
    data: {
      name: 'Categories UI Product',
      slug: projectSlug,
      description: null,
      customDomain: null,
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

  await page.goto(`/products/${projectSlug}#categories`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await expect(page).toHaveURL(new RegExp(`/products/${projectSlug}#categories$`))
  await expect(page.getByText('Feedback Categories')).toBeVisible()
  await expect(page.locator('[data-testid^="product-category-item-"]')).toHaveCount(2)

  const readUiOrder = async () =>
    page.locator('[data-testid^="product-category-item-"]').evaluateAll((elements) =>
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

  const authCookies = (await request.storageState()).cookies.filter((cookie) => cookie.name.startsWith('better-auth'))
  expect(authCookies.length).toBeGreaterThan(0)
  await page.context().addCookies(authCookies)

  const activeTeamResponse = await request.get('/api/teams/active')
  const activeTeamPayload = await activeTeamResponse.json()
  expect(activeTeamResponse.ok()).toBeTruthy()
  const teamId = activeTeamPayload.data.id as string

  const projectSlug = `e2e-domain-${Date.now()}`
  const createProjectResponse = await request.post(`/api/teams/${teamId}/projects`, {
    data: {
      name: 'Domain Product',
      slug: projectSlug,
      description: null,
      customDomain: null,
    },
  })
  expect(createProjectResponse.status()).toBe(201)

  await page.route(`**/api/projects/${projectSlug}/verify-domain?**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        hostname: 'feedback.example.com',
        provider: 'vercel',
        verified: false,
        status: 'ownership_verification_required',
        dnsRecords: [
          {
            type: 'CNAME',
            name: 'feedback.example.com',
            value: '23f9267bd57617a5.vercel-dns-017.com.',
          },
          {
            type: 'CNAME',
            name: 'feedback.example.com',
            value: 'cname.vercel-dns.com.',
          },
        ],
        configuredBy: 'CNAME',
        expected: '23f9267bd57617a5.vercel-dns-017.com.',
        resolvedTo: [],
        message: null,
      }),
    })
  })

  await page.goto(`/products/${projectSlug}#domain`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await expect(page).toHaveURL(new RegExp(`/products/${projectSlug}#domain$`))
  await expect(page.getByText('Required DNS records')).toBeVisible()

  await page.locator('#custom-domain').fill('feedback.example.com')
  await page.getByRole('button', { name: 'Check DNS' }).click()

  await expect(page.getByText('23f9267bd57617a5.vercel-dns-017.com.')).toBeVisible()
  await expect(page.getByText('cname.vercel-dns.com.')).toHaveCount(0)
})

test('custom domain status downgrades from stored verified state after a failed dns check', async ({ request, page }) => {
  await loginViaProgrammatic(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const authCookies = (await request.storageState()).cookies.filter((cookie) => cookie.name.startsWith('better-auth'))
  expect(authCookies.length).toBeGreaterThan(0)
  await page.context().addCookies(authCookies)

  const activeTeamResponse = await request.get('/api/teams/active')
  const activeTeamPayload = await activeTeamResponse.json()
  expect(activeTeamResponse.ok()).toBeTruthy()
  const teamId = activeTeamPayload.data.id as string

  const projectSlug = `e2e-domain-status-${Date.now()}`
  const createProjectResponse = await request.post(`/api/teams/${teamId}/projects`, {
    data: {
      name: 'Domain Status Product',
      slug: projectSlug,
      description: null,
      customDomain: null,
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

  await page.goto(`/products/${projectSlug}#domain`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await expect(page).toHaveURL(new RegExp(`/products/${projectSlug}#domain$`))
  await expect(page.getByTestId('product-domain-status-title')).toHaveText('Domain verified')

  await page.getByRole('button', { name: 'Check DNS' }).click()

  await expect(page.getByTestId('product-domain-status-title')).toHaveText('DNS configuration incomplete')
  await expect(page.getByTestId('product-domain-status-hint')).toHaveText(
    'The domain is added, but the latest DNS check did not find the required records.'
  )
  await expect(page.getByText('No matching DNS records found for')).toBeVisible()
})

test('project categories API supports create/update/reorder/delete with reassignment rules', async ({ request }) => {
  const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

  const activeTeamResponse = await request.get('/api/teams/active', {
    headers: withAuthHeaders(sessionCookie),
  })
  const activeTeamPayload = await activeTeamResponse.json()
  expect(activeTeamResponse.ok()).toBeTruthy()
  const teamId = activeTeamPayload.data.id as string

  const projectSlug = `e2e-cats-${Date.now()}`
  const createProjectResponse = await request.post(`/api/teams/${teamId}/projects`, {
    headers: withAuthHeaders(sessionCookie),
    data: {
      name: 'Categories Product',
      slug: projectSlug,
      description: null,
      customDomain: null,
    },
  })
  expect(createProjectResponse.status()).toBe(201)
  const createProjectPayload = await createProjectResponse.json()
  const projectId = createProjectPayload?.data?.id as string

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

  const publicProjectResponse = await request.get(`/api/public/t/${TEAM_SLUG}/${projectSlug}`)
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
