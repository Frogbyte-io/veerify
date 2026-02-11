import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { Client } from 'pg'

const require = createRequire(import.meta.url)
const isCloudEnvironment = Boolean(
  process.env.GITHUB_ACTIONS ||
    process.env.VERCEL ||
    process.env.CIRCLECI ||
    process.env.BUILDKITE ||
    process.env.CI
)
const isForced = process.env.PLAYWRIGHT_FORCE === '1'
const canRunByEnvironment = isCloudEnvironment || isForced

const skipReasons = []

try {
  require.resolve('@playwright/test')
} catch {
  skipReasons.push('@playwright/test is not installed')
}

function getDbClient() {
  if (process.env.DATABASE_URL) {
    return new Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 4000,
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
    connectionTimeoutMillis: 4000,
  })
}

function hasDbConfiguration() {
  return Boolean(
    process.env.DATABASE_URL ||
      process.env.PGHOST ||
      process.env.PGPORT ||
      process.env.PGUSER ||
      process.env.PGPASSWORD ||
      process.env.PGDATABASE
  )
}

async function verifyDatabaseAvailable() {
  const client = getDbClient()
  try {
    await client.connect()
    await client.query('SELECT 1')
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

const dbAvailable = dbConfigured ? await verifyDatabaseAvailable() : false
if (dbConfigured && !dbAvailable) {
  skipReasons.push('database connection check failed')
}

if (skipReasons.length > 0) {
  console.log(`[playwright] Skipping e2e run: ${skipReasons.join('; ')}.`)
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
