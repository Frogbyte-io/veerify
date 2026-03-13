import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PLAYWRIGHT_PORT || 4173)
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${PORT}`
const betterAuthSecret = process.env.BETTER_AUTH_SECRET || 'playwright-e2e-secret'
const trustedOrigins = Array.from(
  new Set([baseURL, `http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, `http://preview-org.localhost:${PORT}`])
)

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  maxFailures: process.env.CI ? 1 : undefined,
  timeout: process.env.CI ? 60_000 : 90_000,
  globalTimeout: process.env.CI ? 20 * 60_000 : undefined,
  expect: {
    timeout: process.env.CI ? 10_000 : 15_000,
  },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './tests/e2e/global.setup.ts',
  use: {
    baseURL,
    trace: process.env.CI ? 'retain-on-failure' : 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `yarn dev --host localhost --port ${PORT}`,
        url: `${baseURL}/login`,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        env: {
          ...process.env,
          BETTER_AUTH_SECRET: betterAuthSecret,
          BETTER_AUTH_URL: baseURL,
          BETTER_AUTH_TRUSTED_ORIGINS: trustedOrigins.join(','),
        },
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
