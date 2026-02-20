import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { Client } from 'pg'

const require = createRequire(import.meta.url)
const isCloudEnvironment = Boolean(
  process.env.GITHUB_ACTIONS || process.env.VERCEL || process.env.CIRCLECI || process.env.BUILDKITE || process.env.CI
)
const isForced = process.env.PLAYWRIGHT_FORCE === '1'
const canRunByEnvironment = isCloudEnvironment || isForced
const failOnPreflightSkip =
  process.env.PLAYWRIGHT_SKIP_IS_FAILURE === '1' ||
  (isCloudEnvironment && process.env.PLAYWRIGHT_SKIP_IS_FAILURE !== '0')

const skipReasons = []
const requiredSeedUserEmail = process.env.E2E_USER_EMAIL || 'test@preview.local'
const dbConnectionTimeoutMs = Number(process.env.E2E_DB_CONNECT_TIMEOUT_MS) || 4_000

try {
  require.resolve('@playwright/test')
} catch {
  skipReasons.push('@playwright/test is not installed')
}

function getDbClient() {
  if (process.env.DATABASE_URL) {
    return new Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: dbConnectionTimeoutMs,
    })
  }

  // Match local defaults used by server/database/drizzle.ts.
  return new Client({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || 'veerify',
    password: process.env.PGPASSWORD || 'veerifypassword',
    database: process.env.PGDATABASE || 'veerifydb',
    ssl: false,
    connectionTimeoutMillis: dbConnectionTimeoutMs,
  })
}

function hasDbConfiguration() {
  if (process.env.DATABASE_URL) {
    return true
  }

  const requiredPgVars = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']
  const presentPgVars = requiredPgVars.filter((name) => Boolean(process.env[name]))

  if (presentPgVars.length === 0) {
    return false
  }

  const missingPgVars = requiredPgVars.filter((name) => !process.env[name])
  if (missingPgVars.length > 0) {
    skipReasons.push(`database configuration is incomplete (missing ${missingPgVars.join(', ')})`)
    return false
  }

  return true
}

async function verifyDatabaseAvailable() {
  const client = getDbClient()
  try {
    await client.connect()
    await client.query('SELECT 1')

    const schemaCheck = await client.query("SELECT to_regclass('public.user') AS user_table")
    if (!schemaCheck.rows[0]?.user_table) {
      skipReasons.push('database schema is missing required tables (run yarn db:migrate)')
      return false
    }

    const seededUserCheck = await client.query('SELECT 1 FROM "user" WHERE email = $1 LIMIT 1', [requiredSeedUserEmail])
    if ((seededUserCheck.rowCount ?? 0) === 0) {
      skipReasons.push(`e2e seed user "${requiredSeedUserEmail}" was not found (run yarn db:seed)`)
      return false
    }

    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    skipReasons.push(`database not reachable (${message})`)
    return false
  } finally {
    await client.end().catch(() => {})
  }
}

if (!canRunByEnvironment) {
  skipReasons.push('not running in cloud/CI and PLAYWRIGHT_FORCE is not set to 1')
}

const dbConfigured = hasDbConfiguration()
if (!dbConfigured) {
  skipReasons.push('database connection is not configured (set DATABASE_URL or PG* variables)')
}

if (dbConfigured) {
  await verifyDatabaseAvailable()
}

if (skipReasons.length > 0) {
  const reasonSummary = skipReasons.join('; ')

  if (failOnPreflightSkip) {
    console.error(`[playwright] E2E preflight failed: ${reasonSummary}.`)
    process.exit(1)
  }

  console.log(`[playwright] Skipping e2e run: ${reasonSummary}.`)
  console.log('[playwright] Runs require cloud/CI or PLAYWRIGHT_FORCE=1 and a reachable configured database.')
  process.exit(0)
}

const command = process.platform === 'win32' ? 'yarn.cmd' : 'yarn'
const result = spawnSync(command, ['test:e2e'], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
})

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
