import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const isCloudEnvironment = Boolean(
  process.env.GITHUB_ACTIONS ||
    process.env.VERCEL ||
    process.env.CIRCLECI ||
    process.env.BUILDKITE ||
    process.env.CI
)
const isForced = process.env.PLAYWRIGHT_FORCE === '1'
const hasDatabaseConnection = Boolean(process.env.DATABASE_URL || process.env.PGHOST)

const skipReasons = []

if (!isCloudEnvironment && !isForced) {
  skipReasons.push('not running in a cloud/CI environment')
}

if (!hasDatabaseConnection) {
  skipReasons.push('no DATABASE_URL or PGHOST found')
}

try {
  require.resolve('@playwright/test')
} catch {
  skipReasons.push('@playwright/test is not installed')
}

if (skipReasons.length > 0) {
  console.log(`[playwright] Skipping e2e run: ${skipReasons.join('; ')}.`)
  console.log('[playwright] Set PLAYWRIGHT_FORCE=1 to run locally when prerequisites are available.')
  process.exit(0)
}

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const result = spawnSync(command, ['playwright', 'test'], {
  stdio: 'inherit',
  env: process.env,
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
