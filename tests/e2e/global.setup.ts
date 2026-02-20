import { Client } from 'pg'

const REQUIRED_SEED_USER_EMAIL = process.env.E2E_USER_EMAIL || 'test@preview.local'
const REQUIRE_SEED = process.env.E2E_REQUIRE_SEED !== '0'
const CONNECTION_TIMEOUT_MS = Number(process.env.E2E_DB_CONNECT_TIMEOUT_MS) || 4_000

function getDbClient() {
  if (process.env.DATABASE_URL) {
    return new Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    })
  }

  return new Client({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || 'veerify',
    password: process.env.PGPASSWORD || 'veerifypassword',
    database: process.env.PGDATABASE || 'veerifydb',
    ssl: false,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  })
}

export default async function globalSetup() {
  const client = getDbClient()

  try {
    await client.connect()
    await client.query('SELECT 1')

    const schemaCheck = await client.query("SELECT to_regclass('public.user') AS user_table")
    if (!schemaCheck.rows[0]?.user_table) {
      throw new Error('database is reachable but schema is missing required tables (run yarn db:migrate)')
    }

    if (REQUIRE_SEED) {
      const seedCheck = await client.query('SELECT 1 FROM "user" WHERE email = $1 LIMIT 1', [REQUIRED_SEED_USER_EMAIL])
      if ((seedCheck.rowCount ?? 0) === 0) {
        throw new Error(`seed user "${REQUIRED_SEED_USER_EMAIL}" was not found (run yarn db:seed)`)
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`[e2e:preflight] ${message}`)
  } finally {
    await client.end().catch(() => {})
  }
}
