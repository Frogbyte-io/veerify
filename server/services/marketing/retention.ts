import { and, inArray, isNotNull, like, lt } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { competitorChange, marketingUsage, reviewRequest, testimonial } from '~/server/database/schema/marketing'

/**
 * Daily retention prune for the Marketing module.
 *
 * - `review_request` rows in a terminal state (`sent`, `failed`, `skipped`) are deleted after 180 days.
 *   The per-team `marketing_email_suppression` rows stay: they are the durable opt-out record.
 * - `testimonial.author_email` is cleared after 180 days. The public fields (name, title, company, quote) stay.
 * - `competitor_change` rows are deleted after 12 months.
 * - `marketing_usage` rows are deleted once their `YYYY-MM` period is more than 13 months old.
 * - `marketing_usage` `ratelimit:*` counters are only meaningful for a day or an hour, so they are deleted
 *   2 days after their last update.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export const REVIEW_REQUEST_RETENTION_DAYS = 180
export const TESTIMONIAL_EMAIL_RETENTION_DAYS = 180
export const COMPETITOR_CHANGE_RETENTION_MONTHS = 12
export const USAGE_RETENTION_MONTHS = 13
export const RATELIMIT_ROW_RETENTION_DAYS = 2

export const TERMINAL_REVIEW_STATUSES = ['sent', 'failed', 'skipped'] as const

export interface RetentionCutoffs {
  reviewRequests: Date
  testimonialEmails: Date
  competitorChanges: Date
  /** `marketing_usage.period` values strictly below this `YYYY-MM` string are deleted */
  usagePeriod: string
  rateLimitRows: Date
}

function subtractMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime())
  result.setUTCMonth(result.getUTCMonth() - months)
  return result
}

export function retentionCutoffs(now: Date): RetentionCutoffs {
  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  return {
    reviewRequests: new Date(now.getTime() - REVIEW_REQUEST_RETENTION_DAYS * DAY_MS),
    testimonialEmails: new Date(now.getTime() - TESTIMONIAL_EMAIL_RETENTION_DAYS * DAY_MS),
    competitorChanges: subtractMonths(now, COMPETITOR_CHANGE_RETENTION_MONTHS),
    usagePeriod: subtractMonths(firstOfMonth, USAGE_RETENTION_MONTHS).toISOString().slice(0, 7),
    rateLimitRows: new Date(now.getTime() - RATELIMIT_ROW_RETENTION_DAYS * DAY_MS),
  }
}

export interface RetentionSummary {
  reviewRequestsDeleted: number
  testimonialEmailsCleared: number
  competitorChangesDeleted: number
  usageRowsDeleted: number
  rateLimitRowsDeleted: number
}

export interface RetentionDeps {
  now: () => Date
  deleteReviewRequests(cutoff: Date): Promise<number>
  clearTestimonialEmails(cutoff: Date): Promise<number>
  deleteCompetitorChanges(cutoff: Date): Promise<number>
  deleteUsageBeforePeriod(period: string): Promise<number>
  deleteRateLimitRows(cutoff: Date): Promise<number>
}

const defaultDeps: RetentionDeps = {
  now: () => new Date(),
  async deleteReviewRequests(cutoff) {
    const rows = await db
      .delete(reviewRequest)
      .where(and(inArray(reviewRequest.status, [...TERMINAL_REVIEW_STATUSES]), lt(reviewRequest.createdAt, cutoff)))
      .returning({ id: reviewRequest.id })
    return rows.length
  },
  async clearTestimonialEmails(cutoff) {
    const rows = await db
      .update(testimonial)
      .set({ authorEmail: null })
      .where(and(isNotNull(testimonial.authorEmail), lt(testimonial.createdAt, cutoff)))
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
}

export async function runMarketingRetention(partial?: Partial<RetentionDeps>): Promise<RetentionSummary> {
  const deps = { ...defaultDeps, ...partial }
  const cutoffs = retentionCutoffs(deps.now())
  return {
    reviewRequestsDeleted: await deps.deleteReviewRequests(cutoffs.reviewRequests),
    testimonialEmailsCleared: await deps.clearTestimonialEmails(cutoffs.testimonialEmails),
    competitorChangesDeleted: await deps.deleteCompetitorChanges(cutoffs.competitorChanges),
    usageRowsDeleted: await deps.deleteUsageBeforePeriod(cutoffs.usagePeriod),
    rateLimitRowsDeleted: await deps.deleteRateLimitRows(cutoffs.rateLimitRows),
  }
}
