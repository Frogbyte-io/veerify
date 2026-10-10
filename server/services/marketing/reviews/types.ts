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
  teamId: string
  projectSettings: Record<string, unknown> | null
  /** `null` when the team never opened the Tools tab (registry default applies) */
  teamMarketingEnabled: boolean | null
  settings: ReviewSettings | null
}

export interface ReviewRequestInsert {
  id: string
  projectId: string
  teamId: string
  email: string
  name: string | null
  trigger: ReviewRequestTrigger
  sourceId: string | null
  token: string
}

export interface ClaimedReviewRequest {
  id: string
  projectId: string
  teamId: string
  email: string
  name: string | null
  trigger: ReviewRequestTrigger
  sourceId: string | null
  token: string
  projectName: string
  projectSettings: Record<string, unknown> | null
  teamMarketingEnabled: boolean | null
  settings: ReviewSettings | null
  /** Title of the shipped feedback item, for the `shipped` trigger */
  feedbackTitle: string | null
}

export interface ClaimedBatch {
  rows: ClaimedReviewRequest[]
  markSent(id: string, at: Date): Promise<void>
  markFailed(id: string, error: string): Promise<void>
  markSkipped(id: string, reason: string): Promise<void>
}

export interface FeedbackRecipients {
  projectId: string
  status: string
  title: string
  author: { email: string | null; name: string | null }
  subscribers: string[]
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
  isSuppressed(teamId: string, email: string): Promise<boolean>
  /** A queued or sent request for this product and address created at or after `since`. */
  hasRecentRequest(projectId: string, email: string, since: Date): Promise<boolean>
  /** A request that was actually sent at or after `since`, ignoring `excludeId`. */
  hasRecentSentRequest(projectId: string, email: string, since: Date, excludeId: string): Promise<boolean>
  /** Returns false when the unique (project, trigger, source, email) index already holds the event. */
  insertRequest(row: ReviewRequestInsert): Promise<boolean>
  /**
   * Locks up to `limit` queued rows (`FOR UPDATE SKIP LOCKED`) for the duration of `run`,
   * so concurrent passes never send the same request twice.
   */
  claimBatch(limit: number, run: (batch: ClaimedBatch) => Promise<void>): Promise<void>
  loadFeedbackRecipients(feedbackId: string): Promise<FeedbackRecipients | null>
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
  | 'unknown_project'

export interface EnqueueResult {
  queued: boolean
  reason?: EnqueueSkipReason
}
