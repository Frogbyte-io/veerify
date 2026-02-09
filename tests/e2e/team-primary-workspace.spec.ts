import { expect, test } from '@playwright/test'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:4173'
const ORG_SLUG = process.env.E2E_ORG_SLUG || 'preview-org'

test.setTimeout(120_000)

function withAuthHeaders(sessionCookie: string, refererPath = '/products') {
  return {
    cookie: sessionCookie,
    origin: BASE_URL,
    referer: `${BASE_URL}${refererPath}`,
  }
}

test('team-primary API flow keeps public URL orgSlug + projectSlug and enforces duplicate slug conflict', async ({
  request,
}) => {
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
  const sessionCookie = setCookie!.split(';')[0]

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
  const publicProjectResponse = await request.get(`/api/public/${ORG_SLUG}/${uniqueSlug}`)
  const publicProjectPayload = await publicProjectResponse.json()
  expect(publicProjectResponse.ok()).toBeTruthy()
  expect(publicProjectPayload?.data?.project?.slug).toBe(uniqueSlug)
  expect(publicProjectPayload?.data?.organization?.slug).toBe(ORG_SLUG)

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
