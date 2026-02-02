import { Client } from 'pg'
import { scrypt, randomBytes } from 'crypto'
import { promisify } from 'util'

const scryptAsync = promisify(scrypt)

// Reproduces better-auth's password hashing exactly:
// format: salt:hex(scrypt(password, salt, { N: 16384, r: 16, p: 1, dkLen: 64 }))
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const key = await scryptAsync(
    Buffer.from(password.normalize('NFKC')),
    salt,
    64,
    { N: 16384, r: 16, p: 1 }
  )
  return `${salt}:${key.toString('hex')}`
}

const TEST_EMAIL = 'test@preview.local'
const TEST_PASSWORD = 'password123'

async function main() {
  if (process.env.VERCEL_ENV === 'production') {
    console.log('[seed] Production detected, skipping.')
    return
  }

  const client = process.env.DATABASE_URL
    ? new Client({ connectionString: process.env.DATABASE_URL })
    : new Client({
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT) || 5432,
        user: process.env.PGUSER || 'veerify',
        password: process.env.PGPASSWORD || 'veerifypassword',
        database: process.env.PGDATABASE || 'veerifydb',
      })

  await client.connect()

  const { rows } = await client.query(
    'SELECT id FROM "user" WHERE email = $1',
    [TEST_EMAIL]
  )

  if (rows.length > 0) {
    console.log('[seed] Test data already exists, skipping.')
    await client.end()
    return
  }

  const now = new Date().toISOString()
  const passwordHash = await hashPassword(TEST_PASSWORD)

  await client.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, two_factor_enabled)
     VALUES ($1, $2, $3, true, $4, $4, false)`,
    ['seed_preview_user', 'Preview User', TEST_EMAIL, now]
  )

  await client.query(
    `INSERT INTO "account" (id, account_id, provider_id, user_id, password, created_at, updated_at)
     VALUES ($1, $2, 'credential', $3, $4, $5, $5)`,
    ['seed_preview_account', TEST_EMAIL, 'seed_preview_user', passwordHash, now]
  )

  await client.query(
    `INSERT INTO "organization" (id, name, slug, created_at)
     VALUES ($1, $2, $3, $4)`,
    ['seed_preview_org', 'Preview Org', 'preview-org', now]
  )

  await client.query(
    `INSERT INTO "member" (id, organization_id, user_id, role, created_at)
     VALUES ($1, $2, $3, 'owner', $4)`,
    ['seed_preview_member', 'seed_preview_org', 'seed_preview_user', now]
  )

  console.log(`[seed] Created test user: ${TEST_EMAIL} / ${TEST_PASSWORD}`)
  await client.end()
}

main().catch((err) => {
  console.error('[seed] Failed:', err)
  process.exit(1)
})
