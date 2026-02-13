import { Client } from 'pg'
import { scrypt, randomBytes } from 'crypto'
import { promisify } from 'util'
import 'dotenv/config'

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
  project2: 'seed_preview_project_2',
  project3: 'seed_preview_project_3',
  catDemoBug: 'seed_preview_cat_demo_bug',
  catDemoFeature: 'seed_preview_cat_demo_feature',
  catMobileBug: 'seed_preview_cat_mobile_bug',
  catMobileFeature: 'seed_preview_cat_mobile_feature',
  catApiBug: 'seed_preview_cat_api_bug',
  catApiFeature: 'seed_preview_cat_api_feature',
  feedback1: 'seed_preview_feedback_1',
  feedback2: 'seed_preview_feedback_2',
  feedback3: 'seed_preview_feedback_3',
}

const SEED_TEAM_SLUG = 'preview-org'

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
  // Note: Some deletions use specific IDs, others delete by foreign key reference

  // 1. Delete ALL projects that reference the seed team (not just the seed project)
  const { rowCount: projectCount } = await client.query(
    `DELETE FROM "project" WHERE team_id = $1`,
    [IDS.team]
  )
  if (projectCount && projectCount > 0) {
    console.log(`[seed:clean] Deleted ${projectCount} project(s) referencing seed team`)
  }

  // 2. Delete team member
  const { rowCount: teamMemberCount } = await client.query(
    `DELETE FROM "team_member" WHERE id = $1`,
    [IDS.teamMember]
  )
  if (teamMemberCount && teamMemberCount > 0) {
    console.log(`[seed:clean] Deleted team_member (${IDS.teamMember})`)
  }

  // 3. Delete team
  const { rowCount: teamCount } = await client.query(
    `DELETE FROM "team" WHERE id = $1`,
    [IDS.team]
  )
  if (teamCount && teamCount > 0) {
    console.log(`[seed:clean] Deleted team (${IDS.team})`)
  }

  // 4. Delete organization member
  const { rowCount: memberCount } = await client.query(
    `DELETE FROM "member" WHERE id = $1`,
    [IDS.member]
  )
  if (memberCount && memberCount > 0) {
    console.log(`[seed:clean] Deleted member (${IDS.member})`)
  }

  // 5. Delete account
  const { rowCount: accountCount } = await client.query(
    `DELETE FROM "account" WHERE id = $1`,
    [IDS.account]
  )
  if (accountCount && accountCount > 0) {
    console.log(`[seed:clean] Deleted account (${IDS.account})`)
  }

  // 6. Delete organization
  const { rowCount: orgCount } = await client.query(
    `DELETE FROM "organization" WHERE id = $1`,
    [IDS.org]
  )
  if (orgCount && orgCount > 0) {
    console.log(`[seed:clean] Deleted organization (${IDS.org})`)
  }

  // 7. Delete user
  const { rowCount: userCount } = await client.query(
    `DELETE FROM "user" WHERE id = $1`,
    [IDS.user]
  )
  if (userCount && userCount > 0) {
    console.log(`[seed:clean] Deleted user (${IDS.user})`)
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
    `INSERT INTO "team" (id, name, slug, organization_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [IDS.team, 'Default', SEED_TEAM_SLUG, IDS.org, now]
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

  // Additional test projects
  await client.query(
    `INSERT INTO "project" (id, organization_id, team_id, slug, name, description, is_public, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7, $7)`,
    [IDS.project2, IDS.org, IDS.team, 'mobile-app', 'Mobile App', 'iOS and Android mobile application', now]
  )

  await client.query(
    `INSERT INTO "project" (id, organization_id, team_id, slug, name, description, is_public, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7, $7)`,
    [IDS.project3, IDS.org, IDS.team, 'api-platform', 'API Platform', 'REST and GraphQL API services', now]
  )

  // Categories for each project (Bug + Feature)
  const categories = [
    [IDS.catDemoBug, IDS.project, 'Bug', 'bug', '🐛', '#ef4444', "Something isn't working", 0, true],
    [IDS.catDemoFeature, IDS.project, 'Feature', 'feature', '✨', '#10b981', 'A new capability or improvement', 1, true],
    [IDS.catMobileBug, IDS.project2, 'Bug', 'bug', '🐛', '#ef4444', "Something isn't working", 0, true],
    [IDS.catMobileFeature, IDS.project2, 'Feature', 'feature', '✨', '#10b981', 'A new capability or improvement', 1, true],
    [IDS.catApiBug, IDS.project3, 'Bug', 'bug', '🐛', '#ef4444', "Something isn't working", 0, true],
    [IDS.catApiFeature, IDS.project3, 'Feature', 'feature', '✨', '#10b981', 'A new capability or improvement', 1, true],
  ]

  for (const [id, projectId, name, slug, icon, color, description, sortOrder, isDefault] of categories) {
    await client.query(
      `INSERT INTO "feedback_category" (id, project_id, name, slug, icon, color, description, sort_order, is_default, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, projectId, name, slug, icon, color, description, sortOrder, isDefault, now]
    )
  }

  // Sample feedback for Demo Project
  const feedbackItems = [
    [IDS.feedback1, IDS.project, IDS.catDemoFeature, 'Dark mode support', 'It would be great to have a dark mode option for better usability during night hours.', 'open', 5],
    [IDS.feedback2, IDS.project, IDS.catDemoBug, 'Login page crashes on Safari', 'The login form throws an error when submitting on Safari 17.', 'in_progress', 2],
    [IDS.feedback3, IDS.project, IDS.catDemoFeature, 'Add keyboard shortcuts', 'Power users would benefit from keyboard shortcuts for common actions.', 'planned', 8],
  ]

  for (const [id, projectId, categoryId, title, body, status, voteCount] of feedbackItems) {
    await client.query(
      `INSERT INTO "feedback" (id, project_id, category_id, title, body, status, author_user_id, author_name, vote_count, comment_count, is_pinned, is_locked, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, false, false, $10, $10)`,
      [id, projectId, categoryId, title, body, status, IDS.user, 'Preview User', voteCount, now]
    )
  }

  console.log(`[seed] Created test user: ${TEST_EMAIL} / ${TEST_PASSWORD}`)
  console.log('[seed] Created org: Preview Org (preview-org)')
  console.log('[seed] Created team: Default')
  console.log('[seed] Created projects: Demo Project, Mobile App, API Platform')
  console.log('[seed] Created categories: Bug + Feature for each project')
  console.log('[seed] Created 3 feedback items for Demo Project')
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
