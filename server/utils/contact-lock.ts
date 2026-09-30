import { sql } from 'drizzle-orm'
import type { db } from '~/server/database/drizzle'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Namespace for contact-lifecycle advisory locks. `pg_advisory_xact_lock` keys
 * are global per database, so a constant classifier keeps these from colliding
 * with any other advisory lock a future feature introduces.
 */
const CONTACT_LOCK_NAMESPACE = 0x636f6e74 // 'cont'

/**
 * Serialize contact lifecycle mutations within each owning team.
 *
 * Every contact create, update, delete, merge, link, and automatic-link
 * operation acquires this lock before touching contact-owned state. Auto-link
 * policy updates use it too, making a committed setting the clear boundary for
 * later link decisions. A caller may pass multiple teams; sorting keeps
 * cross-team acquisition deterministic and therefore deadlock-free.
 *
 * Deliberately an advisory lock rather than `SELECT … FROM team … FOR UPDATE`.
 * `FOR UPDATE` on a row conflicts with the `FOR KEY SHARE` that PostgreSQL takes
 * on a parent row for every foreign-key check, and twelve tables reference
 * `team.id`. Locking the team row to serialize *contact* writes therefore also
 * blocked every concurrent insert of a conversation, project, inbox, tag, or
 * member for that team - an inbound-email burst for one team would stall
 * unrelated writes for the same team. An advisory lock gives identical mutual
 * exclusion among these callers while touching no row, so foreign-key checks
 * proceed untouched.
 *
 * `pg_advisory_xact_lock` releases at transaction end, so it needs no unlock
 * path and cannot leak on rollback. It takes two 32-bit keys; the team id is
 * hashed with `hashtext` because the ids are opaque strings.
 */
export async function lockContactTeams(tx: Transaction, teamIds: string[]): Promise<void> {
  const orderedTeamIds = [...new Set(teamIds)].sort()
  if (orderedTeamIds.length === 0) return

  for (const teamId of orderedTeamIds) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${CONTACT_LOCK_NAMESPACE}, hashtext(${teamId}))`)
  }
}

export async function lockContactTeam(tx: Transaction, teamId: string): Promise<void> {
  await lockContactTeams(tx, [teamId])
}
