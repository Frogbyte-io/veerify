import { db } from '../server/database/drizzle'
import { user } from '../server/database/schema/auth'
import { ensureDefaultTeamMemberships } from '../server/utils/team-membership'

async function main() {
  const users = await db.select({ id: user.id }).from(user)
  let processed = 0

  for (const row of users) {
    await ensureDefaultTeamMemberships(row.id)
    processed += 1
  }

  console.log(`Backfilled default team memberships for ${processed} users.`)
}

main().catch((error) => {
  console.error('Failed to backfill default team memberships:', error)
  process.exit(1)
})
