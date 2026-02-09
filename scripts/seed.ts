import { Client } from 'pg'
import { scrypt, randomBytes } from 'crypto'
import { promisify } from 'util'

const scryptAsync = promisify(scrypt)

// Reproduces better-auth's password hashing exactly:
// format: salt:hex(scrypt(password, salt, { N: 16384, r: 16, p: 1, dkLen: 64 }))
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const key = await (scryptAsync as any)(Buffer.from(password.normalize('NFKC')), salt, 64, {
    N: 16384,
    r: 16,
    p: 1,
    maxmem: 128 * 16384 * 16 * 2,
  })
  return `${salt}:${(key as Buffer).toString('hex')}`
}

const TEST_EMAIL = 'test@preview.local'
const TEST_PASSWORD = 'password123'

// All seeded row IDs use this prefix so --clean can target them precisely
const IDS = {
  user: 'seed_preview_user',
  account: 'seed_preview_account',
  org: 'seed_preview_org',
  member: 'seed_preview_member',
  team: 'seed_preview_team',
  teamMember: 'seed_preview_team_member',
  project: 'seed_preview_project',
}

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

async function clean(client: Client) {
  // Delete in FK-safe order (children first)
  const tables: [string, string][] = [
    ['project', IDS.project],
    ['team_member', IDS.teamMember],
    ['team', IDS.team],
    ['member', IDS.member],
    ['account', IDS.account],
    ['organization', IDS.org],
    ['user', IDS.user],
  ]

  for (const [table, id] of tables) {
    const { rowCount } = await client.query(`DELETE FROM "${table}" WHERE id = $1`, [id])
    if (rowCount && rowCount > 0) {
      console.log(`[seed:clean] Deleted ${table} (${id})`)
    }
  }

  console.log('[seed:clean] Done.')
}

async function seed(client: Client) {
  const { rows } = await client.query('SELECT id FROM "user" WHERE id = $1', [IDS.user])

  if (rows.length > 0) {
    console.log('[seed] Test data already exists, skipping. Use --clean to remove it first.')
    return
  }

  const now = new Date().toISOString()
  const passwordHash = await hashPassword(TEST_PASSWORD)

  await client.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, two_factor_enabled)
     VALUES ($1, $2, $3, true, $4, $4, false)`,
    [IDS.user, 'Preview User', TEST_EMAIL, now]
  )

  await client.query(
    `INSERT INTO "account" (id, account_id, provider_id, user_id, password, created_at, updated_at)
     VALUES ($1, $2, 'credential', $3, $4, $5, $5)`,
    [IDS.account, TEST_EMAIL, IDS.user, passwordHash, now]
  )

  await client.query(
    `INSERT INTO "organization" (id, name, slug, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $4)`,
    [IDS.org, 'Preview Org', 'preview-org', now]
  )

  await client.query(
    `INSERT INTO "member" (id, organization_id, user_id, role, created_at, updated_at)
     VALUES ($1, $2, $3, 'owner', $4, $4)`,
    [IDS.member, IDS.org, IDS.user, now]
  )

  await client.query(
    `INSERT INTO "team" (id, name, organization_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $4)`,
    [IDS.team, 'Default', IDS.org, now]
  )

  await client.query(
    `INSERT INTO "team_member" (id, team_id, user_id, created_at)
     VALUES ($1, $2, $3, $4)`,
    [IDS.teamMember, IDS.team, IDS.user, now]
  )

  await client.query(
    `INSERT INTO "project" (id, organization_id, team_id, slug, name, description, is_public, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7, $7)`,
    [IDS.project, IDS.org, IDS.team, 'demo', 'Demo Project', 'A sample project for testing feedback flows', now]
  )

  console.log(`[seed] Created test user: ${TEST_EMAIL} / ${TEST_PASSWORD}`)
  console.log('[seed] Created org: Preview Org (preview-org)')
  console.log('[seed] Created team: Default')
  console.log('[seed] Created project: Demo Project (demo)')
}

async function main() {
  if (process.env.VERCEL_ENV === 'production') {
    console.log('[seed] Production detected, skipping.')
    return
  }

  const isClean = process.argv.includes('--clean')

  const client = createClient()
  await client.connect()

  try {
    if (isClean) {
      await clean(client)
    } else {
      await seed(client)
    }
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('[seed] Failed:', err)
  process.exit(1)
})
