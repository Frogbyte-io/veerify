/**
 * Claiming imported activity. Runs only on a verification event (see lib/auth.ts): the verify-email link, a sign-up
 * that arrives verified, or magic-link sign-in flipping the user to verified. Never on other user updates (2FA,
 * update-user), so an email someone else imported is not attached to an account just because it is verified.
 * When a user has a verified email that matches unclaimed `imported_person` rows (in any
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
import { pgErrorCode } from './db-errors'
import { emailPersonExternalId } from './format'

const logger = createLogger('imports:claim')

export type ClaimResult = { people: number; feedback: number; comments: number; votes: number }

const emptyResult = (): ClaimResult => ({ people: 0, feedback: 0, comments: 0, votes: 0 })

/** Better-Auth endpoints that verify an email. Database hooks only claim while one of these is being handled. */
const VERIFICATION_PATHS = ['/verify-email', '/magic-link/verify']

export function isVerificationPath(path: string | null | undefined): boolean {
  return !!path && VERIFICATION_PATHS.some((p) => path === p || path.startsWith(`${p}?`) || path.startsWith(`${p}/`))
}

export const CLAIM_MAX_ATTEMPTS = 3
const CLAIM_RETRY_DELAY_MS = 50
/** unique_violation (a vote cast concurrently) and deadlock_detected: the transaction is safe to run again. */
const RETRYABLE_CODES = new Set(['23505', '40P01'])

/**
 * Claims with up to CLAIM_MAX_ATTEMPTS tries: a verification event fires once, so a transaction that lost a race with
 * a concurrent vote (23505) or deadlocked (40P01) is retried after a short backoff instead of leaving the person
 * unclaimed. Other errors are thrown at once.
 */
export async function claimImportedActivity(userId: string, email: string): Promise<ClaimResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await claimOnce(userId, email)
    } catch (error) {
      const code = pgErrorCode(error)
      if (attempt >= CLAIM_MAX_ATTEMPTS || !code || !RETRYABLE_CODES.has(code)) throw error
      logger.warn('Retrying imported activity claim', { userId, attempt, code })
      await new Promise((resolve) => setTimeout(resolve, CLAIM_RETRY_DELAY_MS * attempt))
    }
  }
}

async function claimOnce(userId: string, email: string): Promise<ClaimResult> {
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
 * Contact erasure: tombstones imported people with this email (case-insensitive) in the organization's projects, and
 * people whose externalId is the address itself. Name, email and avatar are cleared and `erased_at` is set; the row,
 * its `importedPersonId` links and every vote stay, so a re-import finds the person and their votes (no PII comes
 * back, nothing is counted twice) and counters are unchanged. The imported name and email are also nulled on the
 * feedback and comments they authored (`authorUserId` is left alone, also for claimed people).
 *
 * The address is also removed where it survives as an identifier:
 * - a tombstone whose externalId is the address gets `emailPersonExternalId(address)` (what converters emit, so a
 *   re-import from a converter still finds it); if that id is already taken in the project and source, the other row
 *   is kept and this one gets `erased_<person id>`;
 * - issue rows of the organization's import runs that mention the address (externalId or message) are deleted;
 * - staged payloads of draft/committing runs drop the person and every reference by the address
 *   (`authorExternalId` is removed, a vote by it is dropped).
 * An erased person has no email, so claiming (which matches `lower(email)`) never finds it again.
 * Returns the number of people tombstoned. Runs in the caller's transaction.
 *
 * Accepted race: a commit that is still working from a stale in-memory batch and inserts a brand-new person for this
 * just-erased email is not caught by this call. The commit checks the organization's suppression list (written by
 * contact erasure in the same transaction) before creating a person, so it is created tombstoned instead.
 */
export async function eraseImportedPeople(
  organizationId: string,
  email: string,
  tx: Pick<typeof db, 'execute'>
): Promise<number> {
  const address = email.trim().toLowerCase()
  const orgProjects = sql`SELECT id FROM project WHERE organization_id = ${organizationId}`
  // Tombstone first: the row update takes the person's lock, which serializes against the commit engine's per-record
  // `FOR SHARE` (lockPeople). A record inserted afterwards reads the erased state; one inserted before is nulled below.
  const erased = await tx.execute<{ id: string }>(sql`
    UPDATE imported_person SET name = NULL, email = NULL, avatar_url = NULL, erased_at = now(), updated_at = now()
    WHERE (lower(email) = ${address} OR lower(external_id) = ${address})
      AND erased_at IS NULL AND project_id IN (${orgProjects})
    RETURNING id
  `)
  const ids = erased.rows.map((r) => r.id)
  if (ids.length) {
    const idList = sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `
    )
    await tx.execute(
      sql`UPDATE feedback SET author_name = NULL, author_email = NULL WHERE imported_person_id IN (${idList})`
    )
    await tx.execute(
      sql`UPDATE feedback_comment SET author_name = NULL, author_email = NULL WHERE imported_person_id IN (${idList})`
    )
  }

  // ExternalIds that are the address itself, also on people erased before this rewrite existed.
  const hashedId = emailPersonExternalId(address)
  const rawIds = await tx.execute<{ id: string; project_id: string; source: string }>(sql`
    SELECT id, project_id, source FROM imported_person
    WHERE lower(external_id) = ${address} AND erased_at IS NOT NULL AND project_id IN (${orgProjects})
    ORDER BY id
    FOR UPDATE
  `)
  for (const row of rawIds.rows) {
    await tx.execute(sql`
      UPDATE imported_person SET external_id = CASE
        WHEN EXISTS (
          SELECT 1 FROM imported_person q
          WHERE q.project_id = ${row.project_id} AND q.source = ${row.source} AND q.external_id = ${hashedId}
        ) THEN ${'erased_' + row.id}
        ELSE ${hashedId}
      END
      WHERE id = ${row.id}
    `)
  }

  await tx.execute(sql`
    DELETE FROM import_run_issue
    WHERE run_id IN (SELECT r.id FROM import_run r WHERE r.project_id IN (${orgProjects}))
      AND (strpos(lower(coalesce(external_id, '')), ${address}) > 0 OR strpos(lower(message), ${address}) > 0)
  `)

  const staged = await tx.execute<{ id: string; payload: Record<string, unknown> }>(sql`
    SELECT b.id, b.payload FROM import_run_batch b
    JOIN import_run r ON r.id = b.run_id
    WHERE r.status IN ('draft', 'committing') AND r.project_id IN (${orgProjects})
      AND strpos(lower(b.payload::text), ${address}) > 0
    ORDER BY b.id
    FOR UPDATE OF b
  `)
  for (const row of staged.rows) {
    const scrubbed = scrubStagedPayload(row.payload, address)
    if (scrubbed) {
      await tx.execute(
        sql`UPDATE import_run_batch SET payload = ${JSON.stringify(scrubbed)}::jsonb WHERE id = ${row.id}`
      )
    }
  }
  return ids.length
}

type StagedRecord = Record<string, unknown>

/**
 * Removes a person (by email or by an externalId equal to the address) and every reference by the address from a
 * staged batch payload. `address` must be normalized (trimmed, lower case). Returns null when nothing changed.
 */
export function scrubStagedPayload(payload: Record<string, unknown>, address: string): Record<string, unknown> | null {
  const isAddress = (value: unknown) => typeof value === 'string' && value.trim().toLowerCase() === address
  const list = (section: string) => (Array.isArray(payload[section]) ? (payload[section] as StagedRecord[]) : null)
  let changed = false
  const next: Record<string, unknown> = { ...payload }

  const people = list('people')
  if (people) {
    const kept = people.filter((p) => !isAddress(p?.email) && !isAddress(p?.externalId))
    if (kept.length !== people.length) {
      next.people = kept
      changed = true
    }
  }
  const dropAuthor = (rec: StagedRecord): StagedRecord => {
    if (!isAddress(rec?.authorExternalId)) return rec
    changed = true
    const { authorExternalId: _dropped, ...rest } = rec
    return rest
  }
  const feedbackRecords = list('feedback')
  if (feedbackRecords) {
    next.feedback = feedbackRecords.map((rec) => {
      const out = dropAuthor(rec)
      if (!Array.isArray(out?.votes)) return out
      const votes = (out.votes as StagedRecord[]).filter((v) => !isAddress(v?.personExternalId))
      if (votes.length === (out.votes as unknown[]).length) return out
      changed = true
      return { ...out, votes }
    })
  }
  const comments = list('comments')
  if (comments) next.comments = comments.map(dropAuthor)
  return changed ? next : null
}

/**
 * Better-Auth hook entry, called only for verification events (lib/auth.ts): claims in the background when the user's
 * email is verified. Never throws and never delays sign-up or verification; transient conflicts are retried
 * (claimImportedActivity), other failures are logged and the person stays unclaimed.
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
