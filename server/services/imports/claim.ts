/**
 * Claiming imported activity. When a user has a verified email that matches unclaimed `imported_person` rows (in any
 * project, case-insensitive), that person's imported posts, comments and votes are re-pointed to the user.
 *
 * - Only verified emails claim: the user row must exist, have `emailVerified = true` and carry this email.
 * - Import links are kept: `importedPersonId` stays on every row, so a re-import finds the claimed rows and neither
 *   re-creates nor re-counts them.
 * - Double vote (the user already voted on that post): the imported vote row is left as it is (unclaimed) and only
 *   its value is taken out of `feedback.voteCount` (−1 for an upvote, +1 for a downvote; the counter is a signed net
 *   sum, never clamped). Deleting it would let the next re-import insert and count it again.
 * - Idempotent: only persons with `claimedByUserId IS NULL` are processed, and the marker is set in the same
 *   transaction. The person rows are locked `FOR UPDATE`, so concurrent claims cannot double-decrement.
 *
 * Imports never set `authorUserId` / `voterUserId` from a matching email (global constraints). Once a person is claimed
 * here, the commit engine attributes that person's newly imported rows to `claimedByUserId` at insert time
 * (`lockPersonClaims` in commit-phases/context.ts), skipping a vote the user already cast.
 */
import { sql } from 'drizzle-orm'
import { db } from '../../database/drizzle'
import { createLogger } from '../../utils/logger'

const logger = createLogger('imports:claim')

export type ClaimResult = { people: number; feedback: number; comments: number; votes: number }

const emptyResult = (): ClaimResult => ({ people: 0, feedback: 0, comments: 0, votes: 0 })

export async function claimImportedActivity(userId: string, email: string): Promise<ClaimResult> {
  const result = emptyResult()
  if (!userId || !email) return result

  return db.transaction(async (tx) => {
    const owner = await tx.execute<{ id: string }>(sql`
      SELECT id FROM "user"
      WHERE id = ${userId} AND email_verified = true AND lower(email) = lower(${email})
    `)
    if (owner.rows.length === 0) return result

    const people = await tx.execute<{ id: string }>(sql`
      SELECT id FROM imported_person
      WHERE lower(email) = lower(${email}) AND claimed_by_user_id IS NULL
      ORDER BY id
      FOR UPDATE
    `)

    for (const { id: personId } of people.rows) {
      const posts = await tx.execute(sql`
        UPDATE feedback SET author_user_id = ${userId}
        WHERE imported_person_id = ${personId} AND author_user_id IS NULL
      `)
      const comments = await tx.execute(sql`
        UPDATE feedback_comment SET author_user_id = ${userId}
        WHERE imported_person_id = ${personId} AND author_user_id IS NULL
      `)

      // Double votes: take the imported vote's value out of the counter, leave the row unclaimed.
      const merged = await tx.execute<{ id: string }>(sql`
        WITH doubled AS (
          SELECT v.feedback_id, CASE WHEN v.type = 'downvote' THEN -1 ELSE 1 END AS value
          FROM vote v
          WHERE v.imported_person_id = ${personId}
            AND v.voter_user_id IS NULL
            AND EXISTS (SELECT 1 FROM vote u WHERE u.feedback_id = v.feedback_id AND u.voter_user_id = ${userId})
        )
        UPDATE feedback f SET vote_count = f.vote_count - d.value
        FROM doubled d
        WHERE f.id = d.feedback_id
        RETURNING f.id
      `)

      const claimedVotes = await tx.execute(sql`
        UPDATE vote v SET voter_user_id = ${userId}
        WHERE v.imported_person_id = ${personId}
          AND v.voter_user_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM vote u WHERE u.feedback_id = v.feedback_id AND u.voter_user_id = ${userId})
      `)

      await tx.execute(sql`
        UPDATE imported_person SET claimed_by_user_id = ${userId}, updated_at = now()
        WHERE id = ${personId}
      `)

      result.people += 1
      result.feedback += posts.rowCount ?? 0
      result.comments += comments.rowCount ?? 0
      result.votes += merged.rows.length + (claimedVotes.rowCount ?? 0)
    }

    if (result.people > 0) logger.info('Claimed imported activity', { userId, ...result })
    return result
  })
}

/**
 * Contact erasure: tombstones imported people with this email (case-insensitive) in the organization's projects. Name,
 * email and avatar are cleared and `erased_at` is set; the row, its `importedPersonId` links and every vote stay, so a
 * re-import finds the person and their votes (no PII comes back, nothing is counted twice) and counters are unchanged.
 * The imported name and email are also nulled on the feedback and comments they authored (`authorUserId` is left alone,
 * also for claimed people). The person is also removed from the staged payloads of runs that are still draft or
 * committing. An erased person has no email, so claiming (which matches `lower(email)`) never finds it again.
 * Returns the number of people tombstoned. Runs in the caller's transaction.
 */
export async function eraseImportedPeople(
  organizationId: string,
  email: string,
  tx: Pick<typeof db, 'execute'>
): Promise<number> {
  const orgProjects = sql`SELECT id FROM project WHERE organization_id = ${organizationId}`
  const people = sql`
    SELECT ip.id FROM imported_person ip
    WHERE lower(ip.email) = lower(${email}) AND ip.erased_at IS NULL AND ip.project_id IN (${orgProjects})
  `
  await tx.execute(sql`
    UPDATE feedback SET author_name = NULL, author_email = NULL WHERE imported_person_id IN (${people})
  `)
  await tx.execute(sql`
    UPDATE feedback_comment SET author_name = NULL, author_email = NULL WHERE imported_person_id IN (${people})
  `)
  await tx.execute(sql`
    UPDATE import_run_batch b
    SET payload = jsonb_set(
      b.payload,
      '{people}',
      (SELECT coalesce(jsonb_agg(p), '[]'::jsonb) FROM jsonb_array_elements(b.payload->'people') p
        WHERE lower(p->>'email') IS DISTINCT FROM lower(${email}))
    )
    WHERE jsonb_typeof(b.payload->'people') = 'array'
      AND b.run_id IN (
        SELECT r.id FROM import_run r WHERE r.status IN ('draft', 'committing') AND r.project_id IN (${orgProjects})
      )
  `)
  const erased = await tx.execute(sql`
    UPDATE imported_person SET name = NULL, email = NULL, avatar_url = NULL, erased_at = now(), updated_at = now()
    WHERE id IN (${people})
  `)
  return erased.rowCount ?? 0
}

/**
 * Better-Auth hook entry: claims in the background when the user's email is verified. Never throws and never delays
 * sign-up or verification; failures are logged (the person stays unclaimed and the next trigger retries).
 */
export function claimImportedActivityInBackground(user: {
  id: string
  email?: string | null
  emailVerified?: boolean
}) {
  if (user?.emailVerified !== true || !user.email) return
  void claimImportedActivity(user.id, user.email).catch((error) => {
    logger.error('Failed to claim imported activity', {
      userId: user.id,
      error: error instanceof Error ? error.message : error,
    })
  })
}
