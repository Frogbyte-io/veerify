import { expect, test, type APIRequestContext } from '@playwright/test'
import { loginViaProgrammaticPage } from './helpers/auth'

const TEST_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const TEST_PASSWORD = process.env.E2E_USER_PASSWORD || 'password123'

test.setTimeout(120_000)

async function requestCode(request: APIRequestContext, clientName: string) {
  const response = await request.post('/api/device/code', { data: { client_name: clientName } })
  expect(response.status()).toBe(200)
  const body = await response.json()
  // Use only the path so the test does not depend on BETTER_AUTH_URL
  const url = new URL(body.verification_uri_complete)
  return { ...body, completePath: `${url.pathname}${url.search}` as string }
}

async function pollToken(request: APIRequestContext, deviceCode: string) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await request.post('/api/device/token', { data: { device_code: deviceCode } })
    const body = await response.json()
    if (response.status() === 200) return { status: 200, body }
    if (body.error === 'authorization_pending' || body.error === 'slow_down') {
      await new Promise((resolve) => setTimeout(resolve, 5500))
      continue
    }
    return { status: response.status(), body }
  }
  throw new Error('Timed out polling device token')
}

test('signed-out user logs in, approves a device request and the agent gets a key', async ({ browser, request }) => {
  const clientName = `E2E agent ${Date.now()}`
  const device = await requestCode(request, clientName)

  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(device.completePath)

  // Review Focus 5: signed out goes to login and comes back with the code intact
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 })
  await expect(page.getByTestId('login-submit')).toBeEnabled({ timeout: 20_000 })
  await page.getByTestId('login-email').fill(TEST_EMAIL)
  await page.getByTestId('login-password').fill(TEST_PASSWORD)
  await page.getByTestId('login-submit').click()

  await expect(page).toHaveURL(/\/device\?code=/, { timeout: 30_000 })
  await expect(page.getByTestId('device-client-name')).toHaveText(clientName, { timeout: 20_000 })
  await expect(page.getByTestId('device-user-code')).toHaveText(device.user_code)
  await expect(page.getByTestId('device-countdown')).toHaveText(/^\d{2}:\d{2}$/)

  await page.getByTestId('device-allow').click()
  await expect(page.getByTestId('device-result')).toContainText('Approved')

  const token = await pollToken(request, device.device_code)
  expect(token.status).toBe(200)
  expect(token.body.access_token.startsWith('vfy_usr_')).toBe(true)

  const projects = await request.get('/api/projects', {
    headers: { Authorization: `Bearer ${token.body.access_token}` },
  })
  expect(projects.status()).toBe(200)

  await page.goto('/settings#api-keys')
  await expect(page.getByTestId('user-api-keys')).toBeVisible({ timeout: 20_000 })
  const row = page.getByTestId('user-api-key-row').filter({ hasText: clientName })
  await expect(row).toContainText('via device login')

  await context.close()
})

test('user denies a device request and the agent gets access_denied', async ({ page, request }) => {
  const device = await requestCode(request, `E2E deny ${Date.now()}`)
  await loginViaProgrammaticPage(page, { email: TEST_EMAIL, password: TEST_PASSWORD })

  await page.goto(device.completePath)
  await expect(page.getByTestId('device-user-code')).toHaveText(device.user_code, { timeout: 20_000 })
  await page.getByTestId('device-deny').click()
  await expect(page.getByTestId('device-result')).toContainText('Denied')

  const token = await pollToken(request, device.device_code)
  expect(token.status).toBe(400)
  expect(token.body.error).toBe('access_denied')
})
