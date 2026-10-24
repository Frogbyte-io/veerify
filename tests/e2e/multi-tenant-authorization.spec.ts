import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { signInAndGetSessionCookie, withAuthHeaders } from './helpers/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173'

test.setTimeout(60_000)

function anonymousHeaders(refererPath = '/feedback') {
  return {
    origin: BASE_URL,
    referer: `${BASE_URL}${refererPath}`,
    cookie: '',
  }
}

type TestProject = { id: string; slug: string; productId: string; productSlug: string }

async function createTestProject(
  request: APIRequestContext,
  sessionCookie: string,
  slug: string,
  isPublic: boolean = true
): Promise<TestProject> {
  const response = await request.post('/api/projects', {
    headers: withAuthHeaders(sessionCookie, '/workspace'),
    data: {
      name: `E2E Auth Test ${slug}`,
      slug,
      description: 'Created for multi-tenant auth testing',
      isPublic,
    },
  })
  const payload = await response.json()
  expect(response.status(), `Create project failed: ${JSON.stringify(payload)}`).toBe(201)
  expect(payload.data.project.isPublic).toBe(isPublic)

  return {
    id: payload.data.project.id as string,
    slug: payload.data.project.slug as string,
    productId: payload.data.product.id as string,
    productSlug: payload.data.product.slug as string,
  }
}

async function deleteTestProject(request: APIRequestContext, sessionCookie: string, project: TestProject) {
  await request.delete(`/api/projects/${project.slug}`, {
    headers: withAuthHeaders(sessionCookie),
  })
}

async function createFeedbackItem(
  request: APIRequestContext,
  sessionCookie: string,
  projectId: string,
  overrides: Record<string, unknown> = {}
) {
  const response = await request.post('/api/feedback', {
    headers: withAuthHeaders(sessionCookie),
    data: {
      projectId,
      title: `E2E Feedback ${Date.now()}`,
      body: 'Feedback created for e2e authorization coverage.',
      ...overrides,
    },
  })

  const payload = await response.json()
  expect(response.status(), `Create feedback failed: ${JSON.stringify(payload)}`).toBe(201)
  return payload.data.id as string
}

function getErrorCode(payload: any) {
  return payload?.error?.code || payload?.data?.error?.code
}

test.describe('Multi-tenant authorization', () => {
  test('GET /api/feedback requires projectId parameter', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

    // Without projectId should return 400
    const response = await request.get('/api/feedback', {
      headers: withAuthHeaders(sessionCookie),
    })
    expect(response.status()).toBe(400)
    const payload = await response.json()
    expect(getErrorCode(payload)).toBe('VALIDATION_ERROR')
  })

  test('GET /api/feedback filters by projectId correctly', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

    // Create two projects
    const slug1 = `e2e-auth-proj1-${Date.now()}`
    const slug2 = `e2e-auth-proj2-${Date.now()}`
    const project1 = await createTestProject(request, sessionCookie, slug1)
    const projectId1 = project1.id
    const project2 = await createTestProject(request, sessionCookie, slug2)
    const projectId2 = project2.id

    // Create feedback in project 1
    const fb1Response = await request.post('/api/feedback', {
      headers: withAuthHeaders(sessionCookie),
      data: {
        projectId: projectId1,
        title: 'Feedback in Project 1',
        body: 'Should only appear in project 1 queries',
      },
    })
    expect(fb1Response.status()).toBe(201)
    const fb1 = await fb1Response.json()

    // Create feedback in project 2
    const fb2Response = await request.post('/api/feedback', {
      headers: withAuthHeaders(sessionCookie),
      data: {
        projectId: projectId2,
        title: 'Feedback in Project 2',
        body: 'Should only appear in project 2 queries',
      },
    })
    expect(fb2Response.status()).toBe(201)
    const fb2 = await fb2Response.json()

    // Query project 1 - should only return fb1
    const list1Response = await request.get(`/api/feedback?projectId=${projectId1}`, {
      headers: withAuthHeaders(sessionCookie),
    })
    const list1 = await list1Response.json()
    expect(list1.data.items.length).toBeGreaterThan(0)
    const fb1Ids = list1.data.items.map((i: any) => i.id)
    expect(fb1Ids).toContain(fb1.data.id)
    expect(fb1Ids).not.toContain(fb2.data.id)

    // Query project 2 - should only return fb2
    const list2Response = await request.get(`/api/feedback?projectId=${projectId2}`, {
      headers: withAuthHeaders(sessionCookie),
    })
    const list2 = await list2Response.json()
    const fb2Ids = list2.data.items.map((i: any) => i.id)
    expect(fb2Ids).toContain(fb2.data.id)
    expect(fb2Ids).not.toContain(fb1.data.id)

    // Cleanup
    await deleteTestProject(request, sessionCookie, project1)
    await deleteTestProject(request, sessionCookie, project2)
  })

  test('POST /api/feedback to private project requires project access', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

    // Create a private project (isPublic = false by default)
    const slug = `e2e-auth-private-${Date.now()}`
    const project = await createTestProject(request, sessionCookie, slug, false)
    const projectId = project.id

    // User with project access can submit
    const response = await request.post('/api/feedback', {
      headers: withAuthHeaders(sessionCookie),
      data: {
        projectId,
        title: 'Private project feedback',
        body: 'Authorized submission',
      },
    })
    expect(response.status()).toBe(201)

    // Anonymous user cannot submit to private project
    const anonResponse = await request.post('/api/feedback', {
      headers: anonymousHeaders('/feedback'),
      data: {
        projectId,
        title: 'Anonymous attempt',
        body: 'Should fail',
        authorName: 'Anon User',
      },
    })
    expect(anonResponse.status()).toBe(403)

    // Cleanup
    await deleteTestProject(request, sessionCookie, project)
  })

  test('POST /api/feedback to public project allows anonymous submissions', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

    // Create a public project
    const slug = `e2e-auth-public-${Date.now()}`
    const project = await createTestProject(request, sessionCookie, slug, true)
    const projectId = project.id

    // Anonymous user can submit to public project
    const anonResponse = await request.post('/api/feedback', {
      headers: anonymousHeaders('/feedback'),
      data: {
        projectId,
        title: 'Anonymous public feedback',
        body: 'Public submission',
        authorName: 'Public User',
      },
    })
    expect(anonResponse.status()).toBe(201)

    // Cleanup
    await deleteTestProject(request, sessionCookie, project)
  })

  test('POST /api/feedback accepts blank optional identity fields for authenticated users', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

    const slug = `e2e-feedback-auth-blank-${Date.now()}`
    const project = await createTestProject(request, sessionCookie, slug, true)
    const projectId = project.id

    const response = await request.post('/api/feedback', {
      headers: withAuthHeaders(sessionCookie),
      data: {
        projectId,
        title: 'Authenticated blank identity feedback',
        body: 'Should succeed even when optional identity fields are blank.',
        authorName: '',
        authorEmail: '',
      },
    })

    const payload = await response.json()
    expect(response.status(), `Authenticated feedback submit failed: ${JSON.stringify(payload)}`).toBe(201)

    await deleteTestProject(request, sessionCookie, project)
  })

  test('POST /api/feedback rejects blank anonymous author names after normalization', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

    const slug = `e2e-feedback-anon-blank-${Date.now()}`
    const project = await createTestProject(request, sessionCookie, slug, true)
    const projectId = project.id

    const response = await request.post('/api/feedback', {
      headers: anonymousHeaders('/feedback'),
      data: {
        projectId,
        title: 'Anonymous blank identity feedback',
        body: 'Should fail when the anonymous name is blank.',
        authorName: '   ',
        authorEmail: '',
      },
    })

    const payload = await response.json()
    expect(response.status()).toBe(400)
    expect(getErrorCode(payload)).toBe('VALIDATION_ERROR')
    expect(payload?.error?.message || payload?.data?.error?.message).toContain('Name is required')

    await deleteTestProject(request, sessionCookie, project)
  })

  test('POST /api/feedback/[id]/comments accepts blank optional identity fields for authenticated users', async ({
    request,
  }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

    const slug = `e2e-comment-auth-blank-${Date.now()}`
    const project = await createTestProject(request, sessionCookie, slug, true)
    const projectId = project.id
    const feedbackId = await createFeedbackItem(request, sessionCookie, projectId, {
      title: 'Comment target for authenticated blank identity coverage',
    })

    const response = await request.post(`/api/feedback/${feedbackId}/comments`, {
      headers: withAuthHeaders(sessionCookie, '/feedback'),
      data: {
        body: 'Authenticated comments should tolerate blank optional identity fields.',
        authorName: '',
        authorEmail: '',
      },
    })

    const payload = await response.json()
    expect(response.status(), `Authenticated comment submit failed: ${JSON.stringify(payload)}`).toBe(201)

    await deleteTestProject(request, sessionCookie, project)
  })

  test('POST /api/feedback/[id]/comments rejects blank anonymous author names after normalization', async ({
    request,
  }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

    const slug = `e2e-comment-anon-blank-${Date.now()}`
    const project = await createTestProject(request, sessionCookie, slug, true)
    const projectId = project.id
    const feedbackId = await createFeedbackItem(request, sessionCookie, projectId, {
      title: 'Comment target for anonymous blank identity coverage',
    })

    const response = await request.post(`/api/feedback/${feedbackId}/comments`, {
      headers: anonymousHeaders(`/feedback/${feedbackId}`),
      data: {
        body: 'Anonymous comments should fail when the name is blank.',
        authorName: '   ',
        authorEmail: '',
      },
    })

    const payload = await response.json()
    expect(response.status()).toBe(400)
    expect(getErrorCode(payload)).toBe('VALIDATION_ERROR')
    expect(payload?.error?.message || payload?.data?.error?.message).toContain('Name is required')

    await deleteTestProject(request, sessionCookie, project)
  })

  test('POST /api/feedback/[id]/vote only works on public projects', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

    // Create private project
    const privateSlug = `e2e-vote-private-${Date.now()}`
    const privateProject = await createTestProject(request, sessionCookie, privateSlug, false)
    const privateProjectId = privateProject.id

    // Create feedback in private project
    const privateFbResponse = await request.post('/api/feedback', {
      headers: withAuthHeaders(sessionCookie),
      data: {
        projectId: privateProjectId,
        title: 'Private feedback',
        body: 'Cannot vote on this publicly',
      },
    })
    expect(privateFbResponse.status()).toBe(201)
    const privateFb = await privateFbResponse.json()

    // Try to vote on private project feedback (should fail even for project members via public endpoint)
    const votePrivateResponse = await request.post(`/api/feedback/${privateFb.data.id}/vote`, {
      headers: anonymousHeaders('/feedback'),
    })
    expect(votePrivateResponse.status()).toBe(403)

    // Create public project
    const publicSlug = `e2e-vote-public-${Date.now()}`
    const publicProject = await createTestProject(request, sessionCookie, publicSlug, true)
    const publicProjectId = publicProject.id

    // Create feedback in public project
    const publicFbResponse = await request.post('/api/feedback', {
      headers: withAuthHeaders(sessionCookie),
      data: {
        projectId: publicProjectId,
        title: 'Public feedback',
        body: 'Can vote on this publicly',
      },
    })
    expect(publicFbResponse.status()).toBe(201)
    const publicFb = await publicFbResponse.json()

    // Anonymous vote on public project should work
    const votePublicResponse = await request.post(`/api/feedback/${publicFb.data.id}/vote`, {
      headers: anonymousHeaders('/feedback'),
    })
    expect(votePublicResponse.status()).toBe(200)

    // Cleanup
    await deleteTestProject(request, sessionCookie, privateProject)
    await deleteTestProject(request, sessionCookie, publicProject)
  })

  test('GET /api/feedback/[id] verifies project access', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

    // Create private project with feedback
    const slug = `e2e-get-private-${Date.now()}`
    const project = await createTestProject(request, sessionCookie, slug, false)
    const projectId = project.id

    const fbResponse = await request.post('/api/feedback', {
      headers: withAuthHeaders(sessionCookie),
      data: {
        projectId,
        title: 'Private feedback detail',
        body: 'Should not be accessible anonymously',
      },
    })
    const fb = await fbResponse.json()

    // Project member can access
    const memberGetResponse = await request.get(`/api/feedback/${fb.data.id}`, {
      headers: withAuthHeaders(sessionCookie),
    })
    expect(memberGetResponse.status()).toBe(200)

    // Anonymous user cannot access private project feedback
    const anonGetResponse = await request.get(`/api/feedback/${fb.data.id}`, {
      headers: anonymousHeaders('/feedback'),
    })
    expect(anonGetResponse.status()).toBe(403)

    // Cleanup
    await deleteTestProject(request, sessionCookie, project)
  })

  test('GET /api/feedback/[id] allows access to public project feedback', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })

    // Create public project with feedback
    const slug = `e2e-get-public-${Date.now()}`
    const project = await createTestProject(request, sessionCookie, slug, true)
    const projectId = project.id

    const fbResponse = await request.post('/api/feedback', {
      headers: withAuthHeaders(sessionCookie),
      data: {
        projectId,
        title: 'Public feedback detail',
        body: 'Should be accessible to anyone',
      },
    })
    const fb = await fbResponse.json()

    // Anonymous user can access public project feedback
    const anonGetResponse = await request.get(`/api/feedback/${fb.data.id}`, {
      headers: anonymousHeaders('/feedback'),
    })
    expect(anonGetResponse.status()).toBe(200)
    const anonPayload = await anonGetResponse.json()
    expect(anonPayload.data.id).toBe(fb.data.id)

    // Cleanup
    await deleteTestProject(request, sessionCookie, project)
  })

  test('feedback in a private product is hidden from anonymous callers while the project stays public', async ({
    request,
  }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const slug = `e2e-private-product-${Date.now()}`
    const project = await createTestProject(request, sessionCookie, slug, true)

    const productResponse = await request.put(`/api/projects/${project.slug}/products/${project.productId}`, {
      headers: withAuthHeaders(sessionCookie, '/project/settings'),
      data: { isPublic: false },
    })
    expect(productResponse.ok(), await productResponse.text()).toBeTruthy()

    const feedbackId = await createFeedbackItem(request, sessionCookie, project.id, {
      productId: project.productId,
      title: 'Private product feedback',
    })

    // Anonymous callers cannot post to, read, or vote on a private product's board.
    const anonPost = await request.post('/api/feedback', {
      headers: anonymousHeaders('/feedback'),
      data: { projectId: project.id, productId: project.productId, title: 'Nope', body: 'x', authorName: 'Anon' },
    })
    expect([403, 404]).toContain(anonPost.status())

    const anonGet = await request.get(`/api/feedback/${feedbackId}`, { headers: anonymousHeaders('/feedback') })
    expect([403, 404]).toContain(anonGet.status())

    const anonVote = await request.post(`/api/feedback/${feedbackId}/vote`, { headers: anonymousHeaders('/feedback') })
    expect([403, 404]).toContain(anonVote.status())

    // The public product endpoint treats a private product as not found.
    const publicBoard = await request.get(
      `/api/public/o/preview-org/${project.slug}/products/${project.productSlug}/feedback`,
      { headers: anonymousHeaders('/') }
    )
    expect(publicBoard.status()).toBe(404)

    // Project members still see it.
    const memberGet = await request.get(`/api/feedback/${feedbackId}`, { headers: withAuthHeaders(sessionCookie) })
    expect(memberGet.status()).toBe(200)

    await deleteTestProject(request, sessionCookie, project)
  })

  test('GET /api/feedback denies access to projects the caller cannot open', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request, { email: TEST_EMAIL, password: TEST_PASSWORD })
    const slug = `e2e-restricted-${Date.now()}`
    const project = await createTestProject(request, sessionCookie, slug, false)

    const restrict = await request.put(`/api/projects/${project.slug}`, {
      headers: withAuthHeaders(sessionCookie, '/project/settings'),
      data: { accessMode: 'restricted' },
    })
    expect(restrict.ok(), await restrict.text()).toBeTruthy()

    // Another user outside the project's access list gets 403/404.
    const otherCookie = await signInAndGetSessionCookie(request, {
      email: 'personal@preview.local',
      password: TEST_PASSWORD,
    })
    const denied = await request.get(`/api/feedback?projectId=${project.id}`, {
      headers: withAuthHeaders(otherCookie),
    })
    expect([403, 404]).toContain(denied.status())

    const anon = await request.get(`/api/feedback?projectId=${project.id}`, { headers: anonymousHeaders() })
    expect([401, 403, 404]).toContain(anon.status())

    await deleteTestProject(request, sessionCookie, project)
  })
})
