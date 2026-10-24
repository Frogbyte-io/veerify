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

const PERSONAL_EMAIL = 'personal@preview.local'
const PERSONAL_PASSWORD = 'password123'

// All seeded row IDs use this prefix so --clean can target them precisely
const IDS = {
  user: 'seed_preview_user',
  account: 'seed_preview_account',
  personalUser: 'seed_preview_personal_user',
  personalAccount: 'seed_preview_personal_account',
  org: 'seed_preview_org',
  member: 'seed_preview_member',
  projectMember: 'seed_preview_project_member',
  product: 'seed_preview_product',
  product2: 'seed_preview_product_2',
  product3: 'seed_preview_product_3',
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

  // 1. Delete ALL projects in the seed organization (not just the seed projects). Products, project
  //    members and categories cascade; feedback is removed first because feedback.product_id is RESTRICT.
  await client.query(
    `DELETE FROM "feedback" WHERE project_id IN (SELECT id FROM "project" WHERE organization_id = $1)`,
    [IDS.org]
  )
  const { rowCount: projectCount } = await client.query(`DELETE FROM "project" WHERE organization_id = $1`, [IDS.org])
  if (projectCount && projectCount > 0) {
    console.log(`[seed:clean] Deleted ${projectCount} project(s) in the seed organization`)
  }

  // 2. Delete organization member
  const { rowCount: memberCount } = await client.query(`DELETE FROM "member" WHERE id = $1`, [IDS.member])
  if (memberCount && memberCount > 0) {
    console.log(`[seed:clean] Deleted member (${IDS.member})`)
  }

  // 3. Delete account
  const { rowCount: accountCount } = await client.query(`DELETE FROM "account" WHERE id = $1`, [IDS.account])
  if (accountCount && accountCount > 0) {
    console.log(`[seed:clean] Deleted account (${IDS.account})`)
  }

  // 4. Delete organization
  const { rowCount: orgCount } = await client.query(`DELETE FROM "organization" WHERE id = $1`, [IDS.org])
  if (orgCount && orgCount > 0) {
    console.log(`[seed:clean] Deleted organization (${IDS.org})`)
  }

  // 5. Delete user
  const { rowCount: userCount } = await client.query(`DELETE FROM "user" WHERE id = $1`, [IDS.user])
  if (userCount && userCount > 0) {
    console.log(`[seed:clean] Deleted user (${IDS.user})`)
  }

  // 6. Delete personal user account + user
  const { rowCount: personalAccountCount } = await client.query(`DELETE FROM "account" WHERE id = $1`, [
    IDS.personalAccount,
  ])
  if (personalAccountCount && personalAccountCount > 0) {
    console.log(`[seed:clean] Deleted personal account (${IDS.personalAccount})`)
  }

  const { rowCount: personalUserCount } = await client.query(`DELETE FROM "user" WHERE id = $1`, [IDS.personalUser])
  if (personalUserCount && personalUserCount > 0) {
    console.log(`[seed:clean] Deleted personal user (${IDS.personalUser})`)
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
  const personalPasswordHash = await hashPassword(PERSONAL_PASSWORD)

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

  // Personal user — no org or project affiliation
  await client.query(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, two_factor_enabled)
     VALUES ($1, $2, $3, true, $4, $4, false)`,
    [IDS.personalUser, 'Personal User', PERSONAL_EMAIL, now]
  )

  await client.query(
    `INSERT INTO "account" (id, account_id, provider_id, user_id, password, created_at, updated_at)
     VALUES ($1, $2, 'credential', $3, $4, $5, $5)`,
    [IDS.personalAccount, PERSONAL_EMAIL, IDS.personalUser, personalPasswordHash, now]
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

  const projects = [
    [IDS.project, 'demo', 'Demo Project', 'A sample project for testing feedback flows', IDS.product],
    [IDS.project2, 'mobile-app', 'Mobile App', 'iOS and Android mobile application', IDS.product2],
    [IDS.project3, 'api-platform', 'API Platform', 'REST and GraphQL API services', IDS.product3],
  ]

  for (const [id, slug, name, description, productId] of projects) {
    await client.query(
      `INSERT INTO "project" (id, organization_id, slug, name, description, is_public, submission_mode, access_mode, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, 'anonymous', 'workspace', $6, $6)`,
      [id, IDS.org, slug, name, description, now]
    )

    // Every project has a default product with the project's own name and slug
    await client.query(
      `INSERT INTO "product" (id, project_id, name, slug, description, is_public, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, 0, $6, $6)`,
      [productId, id, name, slug, description, now]
    )
  }

  // Explicit project admin row for the owner on the demo project (owners administer every project anyway)
  await client.query(
    `INSERT INTO "project_member" (id, project_id, user_id, role, created_at)
     VALUES ($1, $2, $3, 'admin', $4)`,
    [IDS.projectMember, IDS.project, IDS.user, now]
  )

  // Categories for each project (Bug + Feature)
  const categories = [
    [IDS.catDemoBug, IDS.project, 'Bug', 'bug', '🐛', '#ef4444', "Something isn't working", 0, true],
    [
      IDS.catDemoFeature,
      IDS.project,
      'Feature',
      'feature',
      '✨',
      '#10b981',
      'A new capability or improvement',
      1,
      true,
    ],
    [IDS.catMobileBug, IDS.project2, 'Bug', 'bug', '🐛', '#ef4444', "Something isn't working", 0, true],
    [
      IDS.catMobileFeature,
      IDS.project2,
      'Feature',
      'feature',
      '✨',
      '#10b981',
      'A new capability or improvement',
      1,
      true,
    ],
    [IDS.catApiBug, IDS.project3, 'Bug', 'bug', '🐛', '#ef4444', "Something isn't working", 0, true],
    [
      IDS.catApiFeature,
      IDS.project3,
      'Feature',
      'feature',
      '✨',
      '#10b981',
      'A new capability or improvement',
      1,
      true,
    ],
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
    [
      IDS.feedback1,
      IDS.project,
      IDS.catDemoFeature,
      'Dark mode support',
      'It would be great to have a dark mode option for better usability during night hours.',
      'open',
      5,
    ],
    [
      IDS.feedback2,
      IDS.project,
      IDS.catDemoBug,
      'Login page crashes on Safari',
      'The login form throws an error when submitting on Safari 17.',
      'in_progress',
      2,
    ],
    [
      IDS.feedback3,
      IDS.project,
      IDS.catDemoFeature,
      'Add keyboard shortcuts',
      'Power users would benefit from keyboard shortcuts for common actions.',
      'planned',
      8,
    ],
  ]

  for (const [id, projectId, categoryId, title, body, status, voteCount] of feedbackItems) {
    await client.query(
      `INSERT INTO "feedback" (id, project_id, product_id, category_id, title, body, status, author_user_id, author_name, vote_count, comment_count, is_pinned, is_locked, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, false, false, $11, $11)`,
      [id, projectId, IDS.product, categoryId, title, body, status, IDS.user, 'Preview User', voteCount, now]
    )
  }

  console.log(`[seed] Created org user:      ${TEST_EMAIL} / ${TEST_PASSWORD}`)
  console.log(`[seed] Created personal user: ${PERSONAL_EMAIL} / ${PERSONAL_PASSWORD}`)
  console.log('[seed] Created org: Preview Org (preview-org)')
  console.log('[seed] Created projects (each with a default product): Demo Project, Mobile App, API Platform')
  console.log('[seed] Created categories: Bug + Feature for each project')
  console.log('[seed] Created 3 feedback items for Demo Project')
}

/**
 * Should this run be refused?
 *
 * This script creates accounts with fixed, published passwords
 * (`test@preview.local` / `password123`). Seeding is an explicit development
 * or test operation and is never part of build/package lifecycle hooks.
 *
 * `NODE_ENV=production` blocks the run. `ALLOW_PRODUCTION_SEED=true` exists for the rare deliberate case, e.g.
 * seeding a staging database that legitimately reports itself as production.
 */
function productionSeedBlockReason(): string | null {
  if (process.env.ALLOW_PRODUCTION_SEED === 'true') return null
  if (process.env.NODE_ENV === 'production') return 'NODE_ENV=production'
  return null
}

async function main() {
  const blockReason = productionSeedBlockReason()
  if (blockReason) {
    console.log(
      `[seed] Refusing to seed: ${blockReason}. This script creates accounts with fixed, published ` +
        `passwords. Set ALLOW_PRODUCTION_SEED=true only if you are certain this database is not production.`
    )
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
