import { spawnSync } from 'node:child_process'
import { Client } from 'pg'
import 'dotenv/config'

/**
 * Guarded runner for the Postgres integration suite (SUP-02-4's
 * `displayId` concurrency test).
 *
 * Mirrors `run-redis-integration-if-available.mjs`: skip cleanly with a clear
 * reason when no database is reachable, so `yarn harness:verify` stays green
 * without one running, while still exercising the real `SELECT … FOR UPDATE`
 * row-locking behavior wherever Postgres is available. Guarded separately
 * from the Redis suite so a machine with one dependency but not the other
 * still gets partial coverage instead of an all-or-nothing skip.
 */

const isCloudEnvironment = Boolean(
  process.env.GITHUB_ACTIONS || process.env.VERCEL || process.env.CIRCLECI || process.env.BUILDKITE || process.env.CI
)
const failOnPreflightSkip =
  process.env.POSTGRES_INTEGRATION_SKIP_IS_FAILURE === '1' ||
  (isCloudEnvironment && process.env.POSTGRES_INTEGRATION_SKIP_IS_FAILURE !== '0')

function createClient() {
  return process.env.DATABASE_URL
    ? new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2_000 })
    : new Client({
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT) || 5432,
        user: process.env.PGUSER || 'veerify',
        password: process.env.PGPASSWORD || 'veerifypassword',
        database: process.env.PGDATABASE || 'veerifydb',
        connectionTimeoutMillis: 2_000,
      })
}

async function verifyPostgresAvailable() {
  const client = createClient()

  try {
    await client.connect()
    const result = await client.query('SELECT 1')
    return result.rowCount === 1
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}

const postgresAvailable = await verifyPostgresAvailable()

if (!postgresAvailable) {
  const reason = 'Postgres is not reachable'

  if (failOnPreflightSkip) {
    console.error(`[postgres-integration] Preflight failed: ${reason}.`)
    process.exit(1)
  }

  console.log(`[postgres-integration] Skipping: ${reason}.`)
  console.log('[postgres-integration] Start it locally with: docker compose -f docker-compose-dev.yml up -d db')
  console.log('[postgres-integration] Then apply migrations with: yarn db:migrate')
  process.exit(0)
}

const command = process.platform === 'win32' ? 'yarn.cmd' : 'yarn'

// Run every integration spec except the Redis one, which has its own runner and
// its own reachability guard. Deliberately a pattern rather than a list of
// filenames: this previously named `support-counter.test.ts` explicitly, so a
// second Postgres integration suite was added and silently never ran. Naming
// files here means the gate quietly stops covering whatever nobody remembered
// to add.
const result = spawnSync(
  command,
  ['test:integration', 'tests/integration/', '--exclude', 'tests/integration/redis.test.ts'],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }
)

if (result.error) {
  throw result.error
}

process.exit(result.status ?? 1)
