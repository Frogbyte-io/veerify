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
 * Serialize contact lifecycle mutations within each owning project.
 *
 * Every contact create, update, delete, merge, link, and automatic-link
 * operation acquires this lock before touching contact-owned state. Auto-link
 * policy updates use it too, making a committed setting the clear boundary for
 * later link decisions. A caller may pass multiple projects; sorting keeps
 * cross-project acquisition deterministic and therefore deadlock-free.
 *
 * Deliberately an advisory lock rather than `SELECT … FROM project … FOR UPDATE`.
 * `FOR UPDATE` on a row conflicts with the `FOR KEY SHARE` that PostgreSQL takes
 * on a parent row for every foreign-key check, and twelve tables reference
 * `project.id`. Locking the project row to serialize *contact* writes therefore also
 * blocked every concurrent insert of a conversation, project, inbox, tag, or
 * member for that project - an inbound-email burst for one project would stall
 * unrelated writes for the same project. An advisory lock gives identical mutual
 * exclusion among these callers while touching no row, so foreign-key checks
 * proceed untouched.
 *
 * `pg_advisory_xact_lock` releases at transaction end, so it needs no unlock
 * path and cannot leak on rollback. It takes two 32-bit keys; the project id is
 * hashed with `hashtext` because the ids are opaque strings.
 */
export async function lockContactProjects(tx: Transaction, projectIds: string[]): Promise<void> {
  const orderedProjectIds = [...new Set(projectIds)].sort()
  if (orderedProjectIds.length === 0) return

  for (const projectId of orderedProjectIds) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${CONTACT_LOCK_NAMESPACE}, hashtext(${projectId}))`)
  }
}

export async function lockContactProject(tx: Transaction, projectId: string): Promise<void> {
  await lockContactProjects(tx, [projectId])
}
