import { and, eq, inArray, isNotNull, isNull, like, lt, notLike, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import {
  competitorChange,
  marketingEmailSuppression,
  marketingUsage,
  reviewRequest,
  testimonial,
} from '~/server/database/schema/marketing'
import { createLogger } from '~/server/utils/logger'
import { hashEmail, REDACTED_EMAIL_PREFIX } from '~/server/utils/marketing-email-hash'

const logger = createLogger('marketing-retention')

/**
 * Daily retention for the Marketing module.
 *
 * - `review_request` rows in a terminal state (`sent`, `failed`, `skipped`) are ANONYMISED after 180 days:
 *   `email` becomes `redacted:<id>`, `name` and `error` are cleared. The row keeps its id, token, project,
 *   project, trigger, source, status, timestamps and the keyed `email_hash`, so the unsubscribe and withdraw
 *   links keep working, the `shipped` dedupe slot stays taken, and the person can still be suppressed.
 *   Anonymised rows are deleted after 3 years, and only when no testimonial references them.
 * - `queued` rows older than 30 days are marked `skipped` (`expired`) and then follow the normal schedule.
 *   `sending` rows are left to the stale-claim sweeper.
 * - `testimonial.author_email` is cleared after 180 days; `author_email_hash` and the public fields stay.
 * - Missing hashes are filled lazily right before anonymising (no data migration needed).
 * - The per-workspace `marketing_email_suppression` rows stay: they are the durable opt-out record.
 * - `competitor_change` rows are deleted after 12 months.
 * - `marketing_usage` rows are deleted once their `YYYY-MM` period is more than 13 months old.
 * - `marketing_usage` `ratelimit:*` counters are deleted 2 days after their last update, `digest:*` ledger
 *   rows after 7 days and `oauth-nonce:*` rows after 1 day.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const BACKFILL_BATCH = 500
const BACKFILL_MAX_BATCHES = 40

export const REVIEW_REQUEST_RETENTION_DAYS = 180
export const ANONYMISED_REQUEST_RETENTION_DAYS = 3 * 365
export const QUEUED_REQUEST_EXPIRY_DAYS = 30
export const TESTIMONIAL_EMAIL_RETENTION_DAYS = 180
export const COMPETITOR_CHANGE_RETENTION_MONTHS = 12
export const USAGE_RETENTION_MONTHS = 13
export const RATELIMIT_ROW_RETENTION_DAYS = 2
export const DIGEST_LEDGER_RETENTION_DAYS = 7
export const OAUTH_NONCE_RETENTION_DAYS = 1

export const TERMINAL_REVIEW_STATUSES = ['sent', 'failed', 'skipped'] as const

export interface RetentionCutoffs {
  reviewRequests: Date
  anonymisedRequests: Date
  queuedRequests: Date
  testimonialEmails: Date
  competitorChanges: Date
  /** `marketing_usage.period` values strictly below this `YYYY-MM` string are deleted */
  usagePeriod: string
  rateLimitRows: Date
  digestLedgerRows: Date
  oauthNonceRows: Date
}

function subtractMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime())
  result.setUTCMonth(result.getUTCMonth() - months)
  return result
}

export function retentionCutoffs(now: Date): RetentionCutoffs {
  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS)
  return {
    reviewRequests: daysAgo(REVIEW_REQUEST_RETENTION_DAYS),
    anonymisedRequests: daysAgo(ANONYMISED_REQUEST_RETENTION_DAYS),
    queuedRequests: daysAgo(QUEUED_REQUEST_EXPIRY_DAYS),
    testimonialEmails: daysAgo(TESTIMONIAL_EMAIL_RETENTION_DAYS),
    competitorChanges: subtractMonths(now, COMPETITOR_CHANGE_RETENTION_MONTHS),
    usagePeriod: subtractMonths(firstOfMonth, USAGE_RETENTION_MONTHS).toISOString().slice(0, 7),
    rateLimitRows: daysAgo(RATELIMIT_ROW_RETENTION_DAYS),
    digestLedgerRows: daysAgo(DIGEST_LEDGER_RETENTION_DAYS),
    oauthNonceRows: daysAgo(OAUTH_NONCE_RETENTION_DAYS),
  }
}

export interface RetentionSummary {
  hashesBackfilled: number
  queuedRequestsExpired: number
  reviewRequestsAnonymised: number
  anonymisedRequestsDeleted: number
  testimonialEmailsCleared: number
  competitorChangesDeleted: number
  usageRowsDeleted: number
  rateLimitRowsDeleted: number
  digestLedgerRowsDeleted: number
  oauthNonceRowsDeleted: number
}

export interface RetentionDeps {
  now: () => Date
  /** Fills missing email hashes on rows that are about to be anonymised and on suppressions. Returns rows updated. */
  backfillHashes(cutoffs: RetentionCutoffs): Promise<number>
  expireQueuedRequests(cutoff: Date): Promise<number>
  anonymiseReviewRequests(cutoff: Date): Promise<number>
  deleteAnonymisedRequests(cutoff: Date): Promise<number>
  clearTestimonialEmails(cutoff: Date): Promise<number>
  deleteCompetitorChanges(cutoff: Date): Promise<number>
  deleteUsageBeforePeriod(period: string): Promise<number>
  deleteRateLimitRows(cutoff: Date): Promise<number>
  deleteLedgerRows(prefix: 'digest:' | 'oauth-nonce:', cutoff: Date): Promise<number>
}

const terminal = () => inArray(reviewRequest.status, [...TERMINAL_REVIEW_STATUSES])
const redactedPattern = `${REDACTED_EMAIL_PREFIX}%`

const defaultDeps: RetentionDeps = {
  now: () => new Date(),
  async backfillHashes(cutoffs) {
    let updated = 0
    for (let i = 0; i < BACKFILL_MAX_BATCHES; i++) {
      const rows = await db
        .select({ id: reviewRequest.id, email: reviewRequest.email })
        .from(reviewRequest)
        .where(
          and(
            terminal(),
            lt(reviewRequest.createdAt, cutoffs.reviewRequests),
            isNull(reviewRequest.emailHash),
            notLike(reviewRequest.email, redactedPattern)
          )
        )
        .limit(BACKFILL_BATCH)
      for (const row of rows) {
        await db
          .update(reviewRequest)
          .set({ emailHash: hashEmail(row.email) })
          .where(eq(reviewRequest.id, row.id))
      }
      updated += rows.length
      if (rows.length < BACKFILL_BATCH) break
    }
    for (let i = 0; i < BACKFILL_MAX_BATCHES; i++) {
      const rows = await db
        .select({ id: testimonial.id, email: testimonial.authorEmail })
        .from(testimonial)
        .where(and(isNotNull(testimonial.authorEmail), isNull(testimonial.authorEmailHash)))
        .limit(BACKFILL_BATCH)
      for (const row of rows) {
        await db
          .update(testimonial)
          .set({ authorEmailHash: hashEmail(row.email!) })
          .where(eq(testimonial.id, row.id))
      }
      updated += rows.length
      if (rows.length < BACKFILL_BATCH) break
    }
    for (let i = 0; i < BACKFILL_MAX_BATCHES; i++) {
      const rows = await db
        .select({ organizationId: marketingEmailSuppression.organizationId, email: marketingEmailSuppression.email })
        .from(marketingEmailSuppression)
        .where(and(isNull(marketingEmailSuppression.emailHash), notLike(marketingEmailSuppression.email, 'hash:%')))
        .limit(BACKFILL_BATCH)
      let changed = 0
      for (const row of rows) {
        // A hash-only suppression for the same person may exist; the guard then leaves this row as it is.
        const hash = hashEmail(row.email)
        const done = await db
          .update(marketingEmailSuppression)
          .set({ emailHash: hash })
          .where(
            and(
              eq(marketingEmailSuppression.organizationId, row.organizationId),
              eq(marketingEmailSuppression.email, row.email),
              sql`not exists (select 1 from marketing_email_suppression s where s.organization_id = ${row.organizationId} and s.email_hash = ${hash})`
            )
          )
          .returning({ organizationId: marketingEmailSuppression.organizationId })
        changed += done.length
      }
      updated += changed
      // Rows skipped by the guard would be selected again; stop when a batch made no progress.
      if (rows.length < BACKFILL_BATCH || changed === 0) break
    }
    return updated
  },
  async expireQueuedRequests(cutoff) {
    const rows = await db
      .update(reviewRequest)
      .set({ status: 'skipped', skipReason: 'expired', claimedAt: null })
      .where(and(eq(reviewRequest.status, 'queued'), lt(reviewRequest.createdAt, cutoff)))
      .returning({ id: reviewRequest.id })
    return rows.length
  },
  async anonymiseReviewRequests(cutoff) {
    const rows = await db
      .update(reviewRequest)
      .set({ email: sql`${REDACTED_EMAIL_PREFIX} || ${reviewRequest.id}`, name: null, error: null })
      .where(
        and(
          terminal(),
          lt(reviewRequest.createdAt, cutoff),
          notLike(reviewRequest.email, redactedPattern),
          // Never anonymise without the hash: the row would lose its dedupe slot and suppression handle.
          isNotNull(reviewRequest.emailHash)
        )
      )
      .returning({ id: reviewRequest.id })
    return rows.length
  },
  async deleteAnonymisedRequests(cutoff) {
    const rows = await db
      .delete(reviewRequest)
      .where(
        and(
          terminal(),
          lt(reviewRequest.createdAt, cutoff),
          like(reviewRequest.email, redactedPattern),
          sql`not exists (select 1 from testimonial t where t.review_request_id = ${reviewRequest.id})`
        )
      )
      .returning({ id: reviewRequest.id })
    return rows.length
  },
  async clearTestimonialEmails(cutoff) {
    const rows = await db
      .update(testimonial)
      .set({ authorEmail: null })
      .where(
        and(
          isNotNull(testimonial.authorEmail),
          // The hash is what lets the author be found for erasure later; never clear without it.
          isNotNull(testimonial.authorEmailHash),
          lt(testimonial.createdAt, cutoff)
        )
      )
      .returning({ id: testimonial.id })
    return rows.length
  },
  async deleteCompetitorChanges(cutoff) {
    const rows = await db
      .delete(competitorChange)
      .where(lt(competitorChange.detectedAt, cutoff))
      .returning({ id: competitorChange.id })
    return rows.length
  },
  async deleteUsageBeforePeriod(period) {
    const rows = await db
      .delete(marketingUsage)
      .where(lt(marketingUsage.period, period))
      .returning({ metric: marketingUsage.metric })
    return rows.length
  },
  async deleteRateLimitRows(cutoff) {
    const rows = await db
      .delete(marketingUsage)
      .where(and(like(marketingUsage.metric, 'ratelimit:%'), lt(marketingUsage.updatedAt, cutoff)))
      .returning({ metric: marketingUsage.metric })
    return rows.length
  },
  async deleteLedgerRows(prefix, cutoff) {
    const rows = await db
      .delete(marketingUsage)
      .where(and(like(marketingUsage.metric, `${prefix}%`), lt(marketingUsage.updatedAt, cutoff)))
      .returning({ metric: marketingUsage.metric })
    return rows.length
  },
}

export async function runMarketingRetention(partial?: Partial<RetentionDeps>): Promise<RetentionSummary> {
  const deps = { ...defaultDeps, ...partial }
  const cutoffs = retentionCutoffs(deps.now())

  let hashesBackfilled = 0
  try {
    hashesBackfilled = await deps.backfillHashes(cutoffs)
  } catch (error) {
    // Anonymising and clearing both require a hash, so continuing without one never loses data early.
    logger.error('Email hash backfill failed', { error: error instanceof Error ? error.name : 'unknown' })
  }

  // Expire first so a very old queued row is anonymised in the same run.
  const queuedRequestsExpired = await deps.expireQueuedRequests(cutoffs.queuedRequests)
  return {
    hashesBackfilled,
    queuedRequestsExpired,
    reviewRequestsAnonymised: await deps.anonymiseReviewRequests(cutoffs.reviewRequests),
    anonymisedRequestsDeleted: await deps.deleteAnonymisedRequests(cutoffs.anonymisedRequests),
    testimonialEmailsCleared: await deps.clearTestimonialEmails(cutoffs.testimonialEmails),
    competitorChangesDeleted: await deps.deleteCompetitorChanges(cutoffs.competitorChanges),
    usageRowsDeleted: await deps.deleteUsageBeforePeriod(cutoffs.usagePeriod),
    rateLimitRowsDeleted: await deps.deleteRateLimitRows(cutoffs.rateLimitRows),
    digestLedgerRowsDeleted: await deps.deleteLedgerRows('digest:', cutoffs.digestLedgerRows),
    oauthNonceRowsDeleted: await deps.deleteLedgerRows('oauth-nonce:', cutoffs.oauthNonceRows),
  }
}
