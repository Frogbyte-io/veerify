import type { ReviewPlatform, ReviewRequestTrigger } from '~/server/database/schema/marketing'

export interface ReviewSettings {
  enabled: boolean
  platforms: ReviewPlatform[]
  askForTestimonial: boolean
  csatTrigger: boolean
  csatMinRating: number | null
  shippedTrigger: boolean
  shippedStatusValues: string[]
  cooldownDays: number
}

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  enabled: false,
  platforms: [],
  askForTestimonial: true,
  csatTrigger: true,
  csatMinRating: null,
  shippedTrigger: true,
  shippedStatusValues: ['completed'],
  cooldownDays: 90,
}

/** Everything `enqueueReviewRequest` needs to know about a product, in one read. */
export interface ReviewProjectContext {
  projectId: string
  organizationId: string
  projectSettings: Record<string, unknown> | null
  settings: ReviewSettings | null
}

export interface ReviewRequestInsert {
  id: string
  projectId: string
  email: string
  name: string | null
  trigger: ReviewRequestTrigger
  sourceId: string | null
  token: string
}

export interface ClaimedReviewRequest {
  id: string
  projectId: string
  organizationId: string
  email: string
  name: string | null
  trigger: ReviewRequestTrigger
  sourceId: string | null
  token: string
  /** Failed send attempts before this claim */
  attempts: number
  projectName: string
  projectSettings: Record<string, unknown> | null
  settings: ReviewSettings | null
  /** Title of the shipped feedback item, for the `shipped` trigger */
  feedbackTitle: string | null
}

export interface FeedbackRecipients {
  feedbackId: string
  projectId: string
  status: string
  title: string
  /** Verified recipients only: the author (when a verified account), then verified subscribers, de-duplicated by email */
  recipients: Array<{ email: string; name: string | null }>
}

export interface CsatContext {
  rating: number | null
  scale: 'csat_5' | 'thumbs' | 'nps_10'
  contactEmail: string | null
  contactName: string | null
  projectId: string | null
}

/** Persistence seam for the review request service, so it can be tested without a database. */
export interface ReviewsStore {
  loadProjectContext(projectId: string): Promise<ReviewProjectContext | null>
  /** Suppressed by address or by its keyed hash (an anonymised row's unsubscribe is hash-only). */
  isSuppressed(organizationId: string, email: string): Promise<boolean>
  /**
   * Last check before the mailer is called: the row still exists and is still `sending` (a contact
   * erasure may have deleted it since the claim) and the address is not suppressed.
   */
  stillSendable(id: string, organizationId: string, email: string): Promise<boolean>
  /** A queued, sending or sent request for this product and address created at or after `since`. */
  hasRecentRequest(projectId: string, email: string, since: Date): Promise<boolean>
  /** A request that was actually sent at or after `since`, ignoring `excludeId`. Reads committed state. */
  hasRecentSentRequest(projectId: string, email: string, since: Date, excludeId: string): Promise<boolean>
  /**
   * Returns false when the unique (project, trigger, source, email) index already holds the event.
   * With `dedupeSince` (manual requests, whose NULL sourceId bypasses the unique index) the insert is
   * serialized per (product, address) and refused when a queued, sending or sent request exists since then.
   */
  insertRequest(row: ReviewRequestInsert, options?: { dedupeSince?: Date }): Promise<boolean>
  /** Manual requests queued for a project since `since`, for the daily cap. */
  countManualSince(projectId: string, since: Date): Promise<number>
  /**
   * Returns `sending` rows whose claim is older than `staleAfterMinutes` to `queued`, counting the lost
   * claim as an attempt (`failed` once `maxAttempts` is reached). Returns how many rows were touched.
   */
  sweepStale(staleAfterMinutes: number, maxAttempts: number): Promise<number>
  /**
   * Atomically moves up to `limit` due `queued` rows to `sending` (`FOR UPDATE SKIP LOCKED`, committed
   * immediately) and returns them. No lock is held while sending.
   */
  claimBatch(limit: number): Promise<ClaimedReviewRequest[]>
  /** Outcome writers. All are guarded by `status = 'sending'`, so a swept or finished row is never overwritten. */
  markSent(id: string, at: Date): Promise<void>
  markFailed(id: string, error: string): Promise<void>
  markSkipped(id: string, reason: string): Promise<void>
  /** Back to `queued` with `attempts + 1` and `nextAttemptAt = now + delayMs`. */
  markRetry(id: string, error: string, delayMs: number): Promise<void>
  /** Returns claimed rows that were not processed (out of time) to `queued` without counting an attempt. */
  release(ids: string[]): Promise<void>
  /** One query for all feedback items: verified recipients per item. */
  loadFeedbackRecipients(feedbackIds: string[]): Promise<FeedbackRecipients[]>
  loadCsatContext(responseId: string): Promise<CsatContext | null>
  loadChangelogFeedbackIds(entryId: string): Promise<{ projectId: string; feedbackIds: string[] } | null>
}

export type EnqueueSkipReason =
  | 'invalid_email'
  | 'no_settings'
  | 'disabled'
  | 'trigger_off'
  | 'marketing_off'
  | 'suppressed'
  | 'cooldown'
  | 'duplicate'
  | 'daily_limit'
  | 'unknown_project'

export interface EnqueueResult {
  queued: boolean
  reason?: EnqueueSkipReason
}
