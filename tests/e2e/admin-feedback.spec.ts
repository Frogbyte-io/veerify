import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { isBetterAuthCookie, signInAndGetSessionCookie, withAuthHeaders } from './helpers/auth'
import { selectors } from './helpers/selectors'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'
const STORAGE_DRIVER = process.env.STORAGE_DRIVER || 'local'
const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
  'base64'
)
const UI_WORKFLOW_TIMEOUT = 120_000

test.setTimeout(60_000)

type TestProject = { id: string; slug: string; name: string; productId: string; productSlug: string }

async function createTestProject(
  request: APIRequestContext,
  sessionCookie: string,
  slug: string
): Promise<TestProject> {
  const response = await request.post('/api/projects', {
    headers: withAuthHeaders(sessionCookie, '/workspace'),
    data: {
      name: `E2E Feedback ${slug}`,
      slug,
      description: 'Created by Playwright admin feedback test',
    },
  })
  const payload = await response.json()
  expect(response.status(), `Create project failed: ${JSON.stringify(payload)}`).toBe(201)
  return {
    id: payload.data.project.id as string,
    slug: payload.data.project.slug as string,
    name: payload.data.project.name as string,
    productId: payload.data.product.id as string,
    productSlug: payload.data.product.slug as string,
  }
}

async function addProduct(request: APIRequestContext, sessionCookie: string, project: TestProject, name: string) {
  const response = await request.post(`/api/projects/${project.slug}/products`, {
    headers: withAuthHeaders(sessionCookie, '/project/settings'),
    data: { name },
  })
  const payload = await response.json()
  expect(response.status(), `Create product failed: ${JSON.stringify(payload)}`).toBeLessThan(300)
  return payload.data as { id: string; name: string; slug: string }
}

async function deleteTestProject(request: APIRequestContext, sessionCookie: string, project: TestProject) {
  const response = await request.delete(`/api/projects/${project.slug}`, {
    headers: withAuthHeaders(sessionCookie),
  })
  expect(response.ok()).toBeTruthy()
}

async function activateProject(page: Page, project: TestProject) {
  const response = await page.request.post('/api/projects/active', { data: { projectId: project.id } })
  expect(response.ok()).toBeTruthy()
  await expect
    .poll(
      async () => {
        const active = await page.request.get('/api/projects/active')
        if (!active.ok()) return null
        return (await active.json())?.data?.project?.id ?? null
      },
      { timeout: 20_000, intervals: [500, 1_000, 2_000] }
    )
    .toBe(project.id)
}

async function gotoWithRetry(page: Page, path: string) {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 180_000 })
      return
    } catch (error) {
      lastError = error
      if (attempt < 3) {
        await page.waitForTimeout(1000)
      }
    }
  }
  throw lastError
}

test.describe('Admin feedback workflow', () => {
  test('API: create project, add feedback, delete feedback, delete project', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

    // Create test product
    const slug = `e2e-fb-api-${Date.now()}`
    const project = await createTestProject(request, sessionCookie, slug)

    // Create feedback
    const createFbRes = await request.post('/api/feedback', {
      headers: withAuthHeaders(sessionCookie),
      data: {
        projectId: project.id,
        productId: project.productId,
        title: 'API test feedback item',
        body: 'Created by Playwright API test for admin feedback workflow',
        feedbackType: 'bug_report',
      },
    })
    expect(createFbRes.status()).toBe(201)
    const createFbPayload = await createFbRes.json()
    expect(createFbPayload?.success).toBeTruthy()
    expect(createFbPayload?.data?.metadata?.feedbackType).toBe('bug_report')
    expect(createFbPayload?.data?.productId).toBe(project.productId)
    const feedbackId = createFbPayload.data.id as string

    // Verify feedback appears in list
    const listRes = await request.get(`/api/feedback?projectId=${project.id}`, {
      headers: withAuthHeaders(sessionCookie),
    })
    const listPayload = await listRes.json()
    expect(listRes.ok()).toBeTruthy()
    expect(listPayload.data.items.some((i: any) => i.id === feedbackId)).toBeTruthy()

    // Delete feedback
    const deleteFbRes = await request.delete(`/api/feedback/${feedbackId}`, {
      headers: withAuthHeaders(sessionCookie),
    })
    expect(deleteFbRes.ok()).toBeTruthy()
    const deleteFbPayload = await deleteFbRes.json()
    expect(deleteFbPayload.data.deleted).toBeTruthy()

    // Verify feedback is gone
    const listAfterRes = await request.get(`/api/feedback?projectId=${project.id}`, {
      headers: withAuthHeaders(sessionCookie),
    })
    const listAfterPayload = await listAfterRes.json()
    expect(listAfterPayload.data.items.some((i: any) => i.id === feedbackId)).toBeFalsy()

    // Cleanup: delete the project
    await deleteTestProject(request, sessionCookie, project)
  })

  test('UI: feedback page loads, add and delete feedback', async ({ request, page }) => {
    test.setTimeout(UI_WORKFLOW_TIMEOUT)
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

    // Transfer auth cookies to browser context
    const authCookies = (await request.storageState()).cookies.filter((cookie) => isBetterAuthCookie(cookie.name))
    expect(authCookies.length).toBeGreaterThan(0)
    await page.context().addCookies(authCookies)

    // Create an isolated single-product project via API and make it the active one
    const slug = `e2e-fb-ui-${Date.now()}`
    const project = await createTestProject(request, sessionCookie, slug)
    await activateProject(page, project)

    // The Feedback page follows the active project; no query parameters needed.
    await gotoWithRetry(page, '/feedback')
    await expect(page).toHaveURL(/\/feedback/)

    // Verify page title and Add Feedback button
    await expect(page.getByRole('heading', { name: 'Feedback' })).toBeVisible()
    await expect(page.locator(selectors.feedbackAddButton)).toBeVisible()
    await expect(page.locator(selectors.feedbackAddButton)).toBeEnabled({ timeout: 20_000 })

    // Single-product projects hide the product layer: no product chips.
    await expect(page.locator(selectors.feedbackProductChips)).toHaveCount(0)

    // The Settings tab is available inside the tool.
    await expect(page.locator(selectors.feedbackTabSettings)).toBeVisible()

    // Kanban is the default: search is always visible, table-only controls are hidden.
    await expect(page.locator(selectors.feedbackViewKanban)).toBeVisible()
    await expect(page.locator(selectors.feedbackSearch)).toBeVisible()
    await expect(page.locator(selectors.feedbackStatusFilter)).not.toBeVisible()
    await expect(page.locator(selectors.feedbackSortFilter)).not.toBeVisible()
    const hasKanbanInDefaultView = await page
      .locator(selectors.feedbackKanban)
      .isVisible({ timeout: 5_000 })
      .catch(() => false)
    if (!hasKanbanInDefaultView) {
      await expect(page.locator(selectors.feedbackEmpty)).toBeVisible({ timeout: 20_000 })
    }

    // Switching to table view reveals table controls; search remains visible.
    await page.locator(selectors.feedbackViewTable).click()
    await expect(page.locator(selectors.feedbackSearch)).toBeVisible()
    await expect(page.locator(selectors.feedbackStatusFilter)).toBeVisible()
    await expect(page.locator(selectors.feedbackSortFilter)).toBeVisible()
    const hasTableInListView = await page
      .locator(selectors.feedbackTable)
      .isVisible({ timeout: 5_000 })
      .catch(() => false)
    if (!hasTableInListView) {
      await expect(page.locator(selectors.feedbackEmpty)).toBeVisible({ timeout: 20_000 })
    }

    // Switch back to kanban for the existing create/delete workflow.
    await page.locator(selectors.feedbackViewKanban).click()
    await expect(page.locator(selectors.feedbackSearch)).toBeVisible()
    await expect(page.locator(selectors.feedbackStatusFilter)).not.toBeVisible()
    await expect(page.locator(selectors.feedbackSortFilter)).not.toBeVisible()

    // Fresh test products can legitimately show an empty board first.
    const feedbackKanban = page.locator(selectors.feedbackKanban)
    if (await feedbackKanban.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(page.locator(selectors.feedbackKanbanOpenColumn)).toBeVisible({ timeout: 20_000 })
    } else {
      await expect(page.locator(selectors.feedbackEmpty)).toBeVisible({ timeout: 20_000 })
    }

    await expect(page.locator(selectors.feedbackAddButton)).toBeEnabled({ timeout: 20_000 })

    // Click Add Feedback
    await page.locator(selectors.feedbackAddButton).click()

    // Step 1: select feedback type
    await expect(page.locator('[data-testid="feedback-create-type-feature_request"]')).toBeVisible({ timeout: 5_000 })
    await page.locator('[data-testid="feedback-create-type-feature_request"]').click()

    // Step 2: fill feedback form
    await expect(page.locator(selectors.feedbackCreateTitle)).toBeVisible({ timeout: 5_000 })
    await page.locator(selectors.feedbackCreateTitle).fill('UI Test Feedback Item')
    await page.locator(selectors.feedbackCreateBody).fill('This is test feedback created by Playwright E2E test')

    // Submit
    await page.locator(selectors.feedbackCreateSubmit).click()

    // Wait for dialog to close
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 15_000 })

    // Verify feedback appears in the list
    await expect(page.getByText('UI Test Feedback Item')).toBeVisible({ timeout: 10_000 })

    // Switch to table view for deterministic row-level actions.
    await page.locator(selectors.feedbackViewTable).click()
    await expect(page.locator(selectors.feedbackTable)).toBeVisible({ timeout: 10_000 })

    // Delete the feedback - find the item and click its delete button
    const feedbackItem = page.locator('[data-testid^="feedback-item-"]', { hasText: 'UI Test Feedback Item' }).first()
    const deleteBtn = feedbackItem.locator('button[data-testid^="feedback-item-delete-"]')
    await deleteBtn.click()

    // Confirm deletion
    await expect(page.locator(selectors.feedbackDeleteConfirm)).toBeVisible({ timeout: 5_000 })
    await page.locator(selectors.feedbackDeleteConfirm).click()

    // Wait for dialog to close and verify feedback is gone
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('UI Test Feedback Item')).not.toBeVisible({ timeout: 10_000 })

    // Cleanup: delete the test project via API
    await deleteTestProject(request, sessionCookie, project)
  })

  test('UI: feedback detail page supports edit, comment moderation, and admin controls', async ({ request, page }) => {
    test.setTimeout(UI_WORKFLOW_TIMEOUT)
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const authCookies = (await request.storageState()).cookies.filter((cookie) => isBetterAuthCookie(cookie.name))
    expect(authCookies.length).toBeGreaterThan(0)
    await page.context().addCookies(authCookies)

    const slug = `e2e-fb-detail-${Date.now()}`
    const project = await createTestProject(request, sessionCookie, slug)
    await activateProject(page, project)

    try {
      const createFeedbackResponse = await request.post('/api/feedback', {
        headers: withAuthHeaders(sessionCookie),
        data: {
          projectId: project.id,
          title: 'UI detail feedback item',
          body: 'Created for the feedback detail page workflow test.',
          feedbackType: 'feature_request',
        },
      })
      const createFeedbackPayload = await createFeedbackResponse.json()
      expect(createFeedbackResponse.status(), `Create feedback failed: ${JSON.stringify(createFeedbackPayload)}`).toBe(
        201
      )
      const feedbackId = createFeedbackPayload.data.id as string

      await gotoWithRetry(page, `/feedback/${feedbackId}`)
      await expect(page.locator(selectors.feedbackDetailPage)).toBeVisible({ timeout: 20_000 })
      await expect(page.locator(selectors.feedbackDetailMain)).toBeVisible()
      await expect(page.locator(selectors.feedbackDetailSidebar)).toBeVisible()
      await expect(page.locator(selectors.feedbackDetailAdminCard)).toBeVisible()
      await expect(page.locator(selectors.feedbackDetailStatusSelect)).toBeVisible()
      await expect(page.locator(selectors.feedbackDetailVisibility)).toBeVisible()

      const editedTitle = `Edited detail feedback ${Date.now()}`
      const editedBody = 'Updated from the private feedback detail page.'

      await page.locator(selectors.feedbackDetailEdit).click()
      await expect(page.locator(selectors.feedbackDetailEditTitle)).toBeVisible()
      await page.locator(selectors.feedbackDetailEditTitle).fill(editedTitle)
      await page.locator(selectors.feedbackDetailEditBody).fill(editedBody)
      await page.locator(selectors.feedbackDetailSave).click()
      await expect(page.getByRole('heading', { name: editedTitle })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(editedBody)).toBeVisible()

      await page.locator(selectors.feedbackDetailStatusSelect).selectOption('planned')
      await expect(page.locator(selectors.feedbackDetailStatusSelect)).toHaveValue('planned')

      await page.locator(selectors.feedbackDetailPin).click()
      await expect(page.getByText('Unpin feedback')).toBeVisible({ timeout: 10_000 })

      await page.locator(selectors.feedbackDetailLock).click()
      await expect(page.locator(selectors.feedbackDetailCommentInput)).toBeDisabled({ timeout: 10_000 })
      await page.locator(selectors.feedbackDetailLock).click()
      await expect(page.locator(selectors.feedbackDetailCommentInput)).toBeEnabled({ timeout: 10_000 })

      const commentBody = `Detail comment ${Date.now()}`
      const editedCommentBody = `${commentBody} edited`
      await page.locator(selectors.feedbackDetailCommentInput).fill(commentBody)
      await page.locator(selectors.feedbackDetailCommentSubmit).click()
      await expect(page.getByText(commentBody)).toBeVisible({ timeout: 15_000 })

      const commentCard = page.locator('[data-testid^="feedback-detail-comment-"]', { hasText: commentBody }).first()
      const commentCardTestId = await commentCard.getAttribute('data-testid')
      expect(commentCardTestId).toBeTruthy()
      await commentCard.locator('[data-testid^="comment-edit-btn-"]').click()
      const editingCommentCard = page.locator(`[data-testid="${commentCardTestId}"]`)
      await editingCommentCard.locator('textarea').fill(editedCommentBody)
      await editingCommentCard.getByRole('button', { name: 'Save comment' }).click()
      await expect(page.getByText(editedCommentBody)).toBeVisible({ timeout: 15_000 })

      page.once('dialog', (dialog) => dialog.accept())
      await editingCommentCard.locator('[data-testid^="comment-delete-btn-"]').click()
      await expect(page.getByText(editedCommentBody)).not.toBeVisible({ timeout: 15_000 })
    } finally {
      await deleteTestProject(request, sessionCookie, project)
    }
  })

  test('API: delete project cascades feedback', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

    // Create project
    const slug = `e2e-cascade-${Date.now()}`
    const project = await createTestProject(request, sessionCookie, slug)

    // Create feedback
    const createRes = await request.post('/api/feedback', {
      headers: withAuthHeaders(sessionCookie),
      data: {
        projectId: project.id,
        title: 'Will be cascaded',
        body: 'Testing cascade delete',
      },
    })
    expect(createRes.status()).toBe(201)
    const createdId = (await createRes.json()).data.id as string

    // Delete project (should cascade products and feedback)
    await deleteTestProject(request, sessionCookie, project)

    // The project is gone (404), and so is its feedback row.
    const feedbackRes = await request.get(`/api/feedback?projectId=${project.id}`, {
      headers: withAuthHeaders(sessionCookie),
    })
    expect(feedbackRes.status()).toBe(404)
    const itemRes = await request.get(`/api/feedback/${createdId}`, { headers: withAuthHeaders(sessionCookie) })
    expect(itemRes.status()).toBe(404)
  })

  test('API: delete nonexistent feedback returns 404', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

    const deleteRes = await request.delete('/api/feedback/nonexistent-id-12345', {
      headers: withAuthHeaders(sessionCookie),
    })
    expect(deleteRes.status()).toBe(404)
  })

  test('API: presign/upload/project settings update validates and persists managed assets', async ({ request }) => {
    test.skip(STORAGE_DRIVER !== 'local', 'This API upload flow test currently runs in local storage mode only')

    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

    const unauthorizedPresign = await request.post('/api/projects/demo/assets/presign', {
      headers: { cookie: '' },
      data: {
        kind: 'logo',
        filename: 'logo.png',
        contentType: 'image/png',
        sizeBytes: 1024,
      },
    })
    expect(unauthorizedPresign.status()).toBe(401)

    const invalidMimePresign = await request.post('/api/projects/demo/assets/presign', {
      headers: withAuthHeaders(sessionCookie, '/project/settings#appearance'),
      data: {
        kind: 'logo',
        filename: 'logo.gif',
        contentType: 'image/gif',
        sizeBytes: 1024,
      },
    })
    expect(invalidMimePresign.status()).toBe(400)

    const largeLogoPresign = await request.post('/api/projects/demo/assets/presign', {
      headers: withAuthHeaders(sessionCookie, '/project/settings#appearance'),
      data: {
        kind: 'logo',
        filename: 'logo.png',
        contentType: 'image/png',
        sizeBytes: 3 * 1024 * 1024,
      },
    })
    expect(largeLogoPresign.status()).toBe(400)

    const slug = `e2e-upload-${Date.now()}`
    const project = await createTestProject(request, sessionCookie, slug)

    try {
      const otherProjectPresign = await request.post(`/api/projects/${slug}/assets/presign`, {
        headers: withAuthHeaders(sessionCookie, '/project/settings#appearance'),
        data: {
          kind: 'logo',
          filename: 'logo.png',
          contentType: 'image/png',
          sizeBytes: ONE_BY_ONE_PNG.byteLength,
        },
      })
      expect(otherProjectPresign.ok()).toBeTruthy()
      const otherPresignPayload = await otherProjectPresign.json()
      const otherUpload = otherPresignPayload?.data
      expect(otherUpload?.uploadUrl).toContain('/api/uploads/temp/')

      const otherUploadResult = await request.put(otherUpload.uploadUrl, {
        headers: otherUpload.headers,
        data: ONE_BY_ONE_PNG,
      })
      expect(otherUploadResult.ok()).toBeTruthy()

      const mismatchedUpdate = await request.put('/api/projects/demo', {
        headers: withAuthHeaders(sessionCookie, '/project/settings#appearance'),
        data: {
          settings: {
            logoUploadId: otherUpload.uploadId,
          },
        },
      })
      expect(mismatchedUpdate.status()).toBe(400)

      const validPresign = await request.post('/api/projects/demo/assets/presign', {
        headers: withAuthHeaders(sessionCookie, '/project/settings#appearance'),
        data: {
          kind: 'logo',
          filename: 'logo.png',
          contentType: 'image/png',
          sizeBytes: ONE_BY_ONE_PNG.byteLength,
        },
      })
      expect(validPresign.ok()).toBeTruthy()
      const validPresignPayload = await validPresign.json()
      const validUpload = validPresignPayload?.data

      const validUploadResult = await request.put(validUpload.uploadUrl, {
        headers: validUpload.headers,
        data: ONE_BY_ONE_PNG,
      })
      expect(validUploadResult.ok()).toBeTruthy()

      const updateWithUpload = await request.put('/api/projects/demo', {
        headers: withAuthHeaders(sessionCookie, '/project/settings#appearance'),
        data: {
          settings: {
            logoUploadId: validUpload.uploadId,
          },
        },
      })
      expect(updateWithUpload.ok()).toBeTruthy()
      const updatedPayload = await updateWithUpload.json()
      expect(updatedPayload?.data?.settings?.logoUrl).toContain('/api/uploads/object/')
      expect(updatedPayload?.data?.settings?.logoAssetKey).toContain('projects/')

      const clearLogoUpdate = await request.put('/api/projects/demo', {
        headers: withAuthHeaders(sessionCookie, '/project/settings#appearance'),
        data: {
          settings: {
            logoUrl: null,
            logoAssetKey: null,
          },
        },
      })
      expect(clearLogoUpdate.ok()).toBeTruthy()
    } finally {
      await request.put('/api/projects/demo', {
        headers: withAuthHeaders(sessionCookie, '/project/settings#appearance'),
        data: { settings: null },
      })
      await deleteTestProject(request, sessionCookie, project)
    }
  })

  test('UI: product picker shown for multi-product projects, skipped for single-product', async ({ request, page }) => {
    test.setTimeout(UI_WORKFLOW_TIMEOUT)
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

    const single = await createTestProject(request, sessionCookie, `e2e-picker-single-${Date.now()}`)
    const multi = await createTestProject(request, sessionCookie, `e2e-picker-multi-${Date.now() + 1}`)
    const secondProduct = await addProduct(request, sessionCookie, multi, 'Second product')

    const authCookies = (await request.storageState()).cookies.filter((c) => isBetterAuthCookie(c.name))
    expect(authCookies.length).toBeGreaterThan(0)
    await page.context().addCookies(authCookies)

    try {
      // --- Multi-product project: chips + product select in the form ---------
      await activateProject(page, multi)
      await gotoWithRetry(page, '/feedback')
      await expect(page.locator(selectors.feedbackLoading)).not.toBeVisible({ timeout: 30_000 })

      await expect(page.locator(selectors.feedbackProductChips)).toBeVisible({ timeout: 20_000 })
      await expect(page.locator(selectors.feedbackProductChipAll)).toBeVisible()
      await expect(page.locator(`[data-testid="feedback-product-chip-${multi.productSlug}"]`)).toBeVisible()
      await expect(page.locator(`[data-testid="feedback-product-chip-${secondProduct.slug}"]`)).toBeVisible()

      // Filtering by a product reflects in the URL and keeps the board usable.
      await page.locator(`[data-testid="feedback-product-chip-${secondProduct.slug}"]`).click()
      await expect(page).toHaveURL(new RegExp(`product=${secondProduct.slug}`))

      await expect(page.locator(selectors.feedbackAddButton)).toBeEnabled({ timeout: 10_000 })
      await page.locator(selectors.feedbackAddButton).click()
      await page.locator('[data-testid="feedback-create-type-feature_request"]').click()
      await expect(page.locator(selectors.feedbackCreateTitle)).toBeVisible({ timeout: 5_000 })
      await expect(page.locator(selectors.feedbackCreateProduct)).toBeVisible()

      const title = `Multi product item ${Date.now()}`
      await page.locator(selectors.feedbackCreateProduct).selectOption(secondProduct.id)
      await page.locator(selectors.feedbackCreateTitle).fill(title)
      await page.locator(selectors.feedbackCreateBody).fill('Created through the product select in the create dialog')
      await page.locator(selectors.feedbackCreateSubmit).click()
      await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 15_000 })

      // The item landed in the chosen product.
      const listRes = await request.get(`/api/feedback?projectId=${multi.id}&productId=${secondProduct.id}`, {
        headers: withAuthHeaders(sessionCookie),
      })
      const list = await listRes.json()
      expect(list.data.items.some((i: any) => i.title === title && i.productId === secondProduct.id)).toBeTruthy()
      const otherRes = await request.get(`/api/feedback?projectId=${multi.id}&productId=${multi.productId}`, {
        headers: withAuthHeaders(sessionCookie),
      })
      const other = await otherRes.json()
      expect(other.data.items.some((i: any) => i.title === title)).toBeFalsy()

      // --- Single-product project: product layer hidden ----------------------
      await activateProject(page, single)
      await gotoWithRetry(page, '/feedback')
      await expect(page.locator(selectors.feedbackLoading)).not.toBeVisible({ timeout: 30_000 })
      await expect(page.locator(selectors.feedbackAddButton)).toBeEnabled({ timeout: 10_000 })
      await expect(page.locator(selectors.feedbackProductChips)).toHaveCount(0)

      await page.locator(selectors.feedbackAddButton).click()
      await page.locator('[data-testid="feedback-create-type-feature_request"]').click()
      await expect(page.locator(selectors.feedbackCreateTitle)).toBeVisible({ timeout: 5_000 })
      await expect(page.locator(selectors.feedbackCreateProduct)).toHaveCount(0)
    } finally {
      await deleteTestProject(request, sessionCookie, single)
      await deleteTestProject(request, sessionCookie, multi)
    }
  })
})
