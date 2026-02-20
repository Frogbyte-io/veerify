import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { Client } from 'pg'
import 'dotenv/config'

function createClient() {
  return process.env.DATABASE_URL
    ? new Client({ connectionString: process.env.DATABASE_URL })
    : new Client({
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT) || 5432,
        user: process.env.PGUSER || 'veerify',
        password: process.env.PGPASSWORD || 'veerifypassword',
        database: process.env.PGDATABASE || 'veerifydb',
      })
}

function getDatabaseName() {
  if (process.env.PGDATABASE) return process.env.PGDATABASE

  if (process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL)
      const db = url.pathname.replace(/^\//, '')
      if (db) return db
    } catch {
      // Ignore parse errors and fall back to default.
    }
  }

  return 'veerifydb'
}

async function confirmReset() {
  const dbName = getDatabaseName()
  const rl = createInterface({ input, output })

  try {
    const answer = await rl.question(
      `This will permanently delete all data in database "${dbName}" by dropping and recreating schemas "public" and "drizzle". Are you sure? (y/N): `
    )

    return answer.trim().toLowerCase() === 'y'
  } finally {
    rl.close()
  }
}

async function main() {
  const confirmed = await confirmReset()

  if (!confirmed) {
    console.log('[db:reset] Cancelled.')
    return
  }

  const client = createClient()
  await client.connect()

  try {
    await client.query('BEGIN')
    await client.query('DROP SCHEMA IF EXISTS public CASCADE;')
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE;')
    await client.query('CREATE SCHEMA public;')
    await client.query('COMMIT')
    console.log('[db:reset] Database schema reset completed.')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error('[db:reset] Failed:', error)
  process.exit(1)
})
