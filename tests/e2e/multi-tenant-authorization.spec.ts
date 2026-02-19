import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4173'

test.setTimeout(60_000)

function withAuthHeaders(sessionCookie: string, refererPath = '/feedback') {
  return {
    cookie: sessionCookie,
    origin: BASE_URL,
    referer: `${BASE_URL}${refererPath}`,
  }
}

async function signInAndGetSessionCookie(request: APIRequestContext) {
  const signInResponse = await request.post('/api/auth/sign-in/email', {
    headers: {
      origin: BASE_URL,
      referer: `${BASE_URL}/login`,
    },
    data: {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    },
  })

  const signInPayload = await signInResponse.json().catch(() => null)
  expect(signInResponse.ok(), `Sign-in failed: ${JSON.stringify(signInPayload ?? {})}`).toBeTruthy()

  const setCookie = signInResponse.headers()['set-cookie']
  expect(setCookie, 'Sign-in response missing Set-Cookie').toBeTruthy()
  return setCookie!.split(';')[0]
}

async function getActiveTeamId(request: APIRequestContext, sessionCookie: string) {
  const response = await request.get('/api/teams/active', {
    headers: withAuthHeaders(sessionCookie),
  })
  const payload = await response.json()
  expect(response.ok()).toBeTruthy()
  return payload.data.id as string
}

async function createTestProject(
  request: APIRequestContext,
  sessionCookie: string,
  teamId: string,
  slug: string,
  isPublic: boolean = false
) {
  const response = await request.post(`/api/teams/${teamId}/projects`, {
    headers: withAuthHeaders(sessionCookie, '/products'),
    data: {
      name: `E2E Auth Test ${slug}`,
      slug,
      description: 'Created for multi-tenant auth testing',
      customDomain: null,
      settings: { isPublic },
    },
  })
  const payload = await response.json()
  expect(response.status(), `Create project failed: ${JSON.stringify(payload)}`).toBe(201)
  return payload.data.id as string
}

async function deleteTestProject(request: APIRequestContext, sessionCookie: string, teamId: string, projectId: string) {
  await request.delete(`/api/teams/${teamId}/projects/${projectId}`, {
    headers: withAuthHeaders(sessionCookie),
  })
}

test.describe('Multi-tenant authorization', () => {
  test('GET /api/feedback requires projectId parameter', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request)

    // Without projectId should return 400
    const response = await request.get('/api/feedback', {
      headers: withAuthHeaders(sessionCookie),
    })
    expect(response.status()).toBe(400)
    const payload = await response.json()
    expect(payload.error?.code).toBe('VALIDATION_ERROR')
  })

  test('GET /api/feedback filters by projectId correctly', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request)
    const teamId = await getActiveTeamId(request, sessionCookie)

    // Create two projects
    const slug1 = `e2e-auth-proj1-${Date.now()}`
    const slug2 = `e2e-auth-proj2-${Date.now()}`
    const projectId1 = await createTestProject(request, sessionCookie, teamId, slug1)
    const projectId2 = await createTestProject(request, sessionCookie, teamId, slug2)

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
    await deleteTestProject(request, sessionCookie, teamId, projectId1)
    await deleteTestProject(request, sessionCookie, teamId, projectId2)
  })

  test('POST /api/feedback to private project requires team membership', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request)
    const teamId = await getActiveTeamId(request, sessionCookie)

    // Create a private project (isPublic = false by default)
    const slug = `e2e-auth-private-${Date.now()}`
    const projectId = await createTestProject(request, sessionCookie, teamId, slug, false)

    // User who is team member can submit
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
      headers: {
        origin: BASE_URL,
        referer: `${BASE_URL}/feedback`,
      },
      data: {
        projectId,
        title: 'Anonymous attempt',
        body: 'Should fail',
        authorName: 'Anon User',
      },
    })
    expect(anonResponse.status()).toBe(403)

    // Cleanup
    await deleteTestProject(request, sessionCookie, teamId, projectId)
  })

  test('POST /api/feedback to public project allows anonymous submissions', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request)
    const teamId = await getActiveTeamId(request, sessionCookie)

    // Create a public project
    const slug = `e2e-auth-public-${Date.now()}`
    const projectId = await createTestProject(request, sessionCookie, teamId, slug, true)

    // Anonymous user can submit to public project
    const anonResponse = await request.post('/api/feedback', {
      headers: {
        origin: BASE_URL,
        referer: `${BASE_URL}/feedback`,
      },
      data: {
        projectId,
        title: 'Anonymous public feedback',
        body: 'Public submission',
        authorName: 'Public User',
      },
    })
    expect(anonResponse.status()).toBe(201)

    // Cleanup
    await deleteTestProject(request, sessionCookie, teamId, projectId)
  })

  test('POST /api/feedback/[id]/vote only works on public projects', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request)
    const teamId = await getActiveTeamId(request, sessionCookie)

    // Create private project
    const privateSlug = `e2e-vote-private-${Date.now()}`
    const privateProjectId = await createTestProject(request, sessionCookie, teamId, privateSlug, false)

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

    // Try to vote on private project feedback (should fail even for team members via public endpoint)
    const votePrivateResponse = await request.post(`/api/feedback/${privateFb.data.id}/vote`, {
      headers: {
        origin: BASE_URL,
        referer: `${BASE_URL}/feedback`,
      },
    })
    expect(votePrivateResponse.status()).toBe(403)

    // Create public project
    const publicSlug = `e2e-vote-public-${Date.now()}`
    const publicProjectId = await createTestProject(request, sessionCookie, teamId, publicSlug, true)

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
      headers: {
        origin: BASE_URL,
        referer: `${BASE_URL}/feedback`,
      },
    })
    expect(votePublicResponse.status()).toBe(200)

    // Cleanup
    await deleteTestProject(request, sessionCookie, teamId, privateProjectId)
    await deleteTestProject(request, sessionCookie, teamId, publicProjectId)
  })

  test('GET /api/feedback/[id] verifies project access', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request)
    const teamId = await getActiveTeamId(request, sessionCookie)

    // Create private project with feedback
    const slug = `e2e-get-private-${Date.now()}`
    const projectId = await createTestProject(request, sessionCookie, teamId, slug, false)

    const fbResponse = await request.post('/api/feedback', {
      headers: withAuthHeaders(sessionCookie),
      data: {
        projectId,
        title: 'Private feedback detail',
        body: 'Should not be accessible anonymously',
      },
    })
    const fb = await fbResponse.json()

    // Team member can access
    const memberGetResponse = await request.get(`/api/feedback/${fb.data.id}`, {
      headers: withAuthHeaders(sessionCookie),
    })
    expect(memberGetResponse.status()).toBe(200)

    // Anonymous user cannot access private project feedback
    const anonGetResponse = await request.get(`/api/feedback/${fb.data.id}`, {
      headers: {
        origin: BASE_URL,
        referer: `${BASE_URL}/feedback`,
      },
    })
    expect(anonGetResponse.status()).toBe(403)

    // Cleanup
    await deleteTestProject(request, sessionCookie, teamId, projectId)
  })

  test('GET /api/feedback/[id] allows access to public project feedback', async ({ request }) => {
    const sessionCookie = await signInAndGetSessionCookie(request)
    const teamId = await getActiveTeamId(request, sessionCookie)

    // Create public project with feedback
    const slug = `e2e-get-public-${Date.now()}`
    const projectId = await createTestProject(request, sessionCookie, teamId, slug, true)

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
      headers: {
        origin: BASE_URL,
        referer: `${BASE_URL}/feedback`,
      },
    })
    expect(anonGetResponse.status()).toBe(200)
    const anonPayload = await anonGetResponse.json()
    expect(anonPayload.data.id).toBe(fb.data.id)

    // Cleanup
    await deleteTestProject(request, sessionCookie, teamId, projectId)
  })
})
