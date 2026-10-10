import { randomBytes, randomUUID } from 'node:crypto'
import { sendMarketingReviewRequestEmail } from '~/lib/email'
import type { ReviewRequestTrigger } from '~/server/database/schema/marketing'
import { createLogger } from '~/server/utils/logger'
import { describeError, scrubEmails } from './errors'
import { isMarketingOn } from './guards'
import { dbReviewsStore } from './store'
import type { ClaimedReviewRequest, EnqueueResult, ReviewsStore } from './types'

const logger = createLogger('marketing-reviews')

const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const REVIEW_BATCH_SIZE = 50

/** A `sending` claim older than this is considered abandoned (crashed worker) and swept back to `queued`. */
export const CLAIM_STALE_MINUTES = 10
/** Send attempts before a request is marked `failed`. */
export const MAX_SEND_ATTEMPTS = 3
/** Delay before the next try, indexed by failed attempts so far minus one. */
export const RETRY_BACKOFF_MS = [15 * MINUTE_MS, 60 * MINUTE_MS, 6 * 60 * MINUTE_MS]

/** Most recipients one published changelog entry may fan out to. */
export const MAX_CHANGELOG_RECIPIENTS = 200
/** Manually queued requests per team per rolling day. */
export const MANUAL_DAILY_CAP = 100

export interface EnqueueInput {
  projectId: string
  email: string
  name?: string | null
  trigger: ReviewRequestTrigger
  sourceId?: string | null
}

export interface ReviewServiceDeps {
  store?: ReviewsStore
  sendEmail?: typeof sendMarketingReviewRequestEmail
  now?: () => Date
  baseUrl?: string
}

export function generateReviewToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Highest rating on a CSAT scale, used when a product has no explicit minimum rating. */
export function csatTopScore(scale: 'csat_5' | 'thumbs' | 'nps_10'): number {
  if (scale === 'thumbs') return 2
  if (scale === 'nps_10') return 10
  return 5
}

/** A rating qualifies at or above the configured minimum (clamped to the scale), else only the top score. */
export function csatRatingQualifies(
  rating: number | null,
  scale: 'csat_5' | 'thumbs' | 'nps_10',
  minRating: number | null
): boolean {
  if (rating === null || rating === undefined) return false
  const top = csatTopScore(scale)
  const threshold = Math.min(minRating ?? top, top)
  return rating >= threshold
}

/**
 * Queue a review/testimonial request.
 *
 * Skipped requests are NOT inserted: a skipped row would occupy the unique
 * (project, trigger, source, email) slot and block a later legitimate retry,
 * and the log would fill with rows for people we never contacted. The reason is
 * returned to the caller instead (the manual send dialog shows it).
 *
 * Manual requests (no source id) are not covered by the unique index, so the
 * store serializes them per address and refuses one inside the cooldown.
 */
export async function enqueueReviewRequest(input: EnqueueInput, deps: ReviewServiceDeps = {}): Promise<EnqueueResult> {
  const store = deps.store ?? dbReviewsStore
  const now = (deps.now ?? (() => new Date()))()

  const email = (input.email ?? '').trim().toLowerCase()
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) return { queued: false, reason: 'invalid_email' }

  const ctx = await store.loadProjectContext(input.projectId)
  if (!ctx) return { queued: false, reason: 'unknown_project' }
  if (!ctx.settings) return { queued: false, reason: 'no_settings' }
  const settings = ctx.settings
  if (!settings.enabled) return { queued: false, reason: 'disabled' }
  if (input.trigger === 'csat' && !settings.csatTrigger) return { queued: false, reason: 'trigger_off' }
  if (input.trigger === 'shipped' && !settings.shippedTrigger) return { queued: false, reason: 'trigger_off' }
  if (!isMarketingOn(ctx)) return { queued: false, reason: 'marketing_off' }

  if (await store.isSuppressed(ctx.teamId, email)) return { queued: false, reason: 'suppressed' }

  const since = new Date(now.getTime() - settings.cooldownDays * DAY_MS)
  if (await store.hasRecentRequest(ctx.projectId, email, since)) return { queued: false, reason: 'cooldown' }

  const sourceId = input.sourceId ?? null
  const inserted = await store.insertRequest(
    {
      id: randomUUID(),
      projectId: ctx.projectId,
      teamId: ctx.teamId,
      email,
      name: input.name?.trim() ? input.name.trim().slice(0, 200) : null,
      trigger: input.trigger,
      sourceId,
      token: generateReviewToken(),
    },
    sourceId === null ? { dedupeSince: since } : undefined
  )
  return inserted ? { queued: true } : { queued: false, reason: 'duplicate' }
}

/**
 * Queue manual requests for a list of addresses. Each address gets its own result.
 * At most `MANUAL_DAILY_CAP` manual requests are queued per team per rolling day.
 */
export async function enqueueManualReviewRequests(
  input: { projectId: string; emails: string[] },
  deps: ReviewServiceDeps = {}
): Promise<Array<{ email: string; queued: boolean; reason?: string }>> {
  const store = deps.store ?? dbReviewsStore
  const now = (deps.now ?? (() => new Date()))()

  const ctx = await store.loadProjectContext(input.projectId)
  let remaining = MANUAL_DAILY_CAP
  if (ctx) {
    remaining = MANUAL_DAILY_CAP - (await store.countManualSince(ctx.teamId, new Date(now.getTime() - DAY_MS)))
  }

  const seen = new Set<string>()
  const results: Array<{ email: string; queued: boolean; reason?: string }> = []
  for (const raw of input.emails) {
    const email = raw.trim().toLowerCase()
    if (seen.has(email)) continue
    seen.add(email)

    if (remaining <= 0) {
      results.push({ email, queued: false, reason: 'daily_limit' })
      continue
    }
    const result = await enqueueReviewRequest(
      { projectId: input.projectId, email, trigger: 'manual', sourceId: null },
      deps
    )
    if (result.queued) remaining -= 1
    results.push({ email, queued: result.queued, ...(result.reason ? { reason: result.reason } : {}) })
  }
  return results
}

/** Enqueue for the CSAT contact when the rating qualifies. */
export async function enqueueForCsatResponse(responseId: string, deps: ReviewServiceDeps = {}): Promise<EnqueueResult> {
  const store = deps.store ?? dbReviewsStore
  const csat = await store.loadCsatContext(responseId)
  if (!csat || !csat.projectId || !csat.contactEmail) return { queued: false, reason: 'unknown_project' }

  const ctx = await store.loadProjectContext(csat.projectId)
  if (!ctx?.settings) return { queued: false, reason: 'no_settings' }
  if (!csatRatingQualifies(csat.rating, csat.scale, ctx.settings.csatMinRating)) {
    return { queued: false, reason: 'trigger_off' }
  }

  // Contacts who replied to the support team (and rated the conversation) are acceptable recipients:
  // they wrote to the team themselves from that address, so no extra verification applies.
  return enqueueReviewRequest(
    {
      projectId: csat.projectId,
      email: csat.contactEmail,
      name: csat.contactName,
      trigger: 'csat',
      sourceId: responseId,
    },
    deps
  )
}

/** After a feedback status change: enqueue for the verified author and subscribers when the new status is a shipped one. */
export async function enqueueForFeedbackStatus(feedbackId: string, deps: ReviewServiceDeps = {}): Promise<number> {
  const store = deps.store ?? dbReviewsStore
  const [fb] = await store.loadFeedbackRecipients([feedbackId])
  if (!fb) return 0

  const ctx = await store.loadProjectContext(fb.projectId)
  if (!ctx?.settings || !ctx.settings.shippedStatusValues.includes(fb.status)) return 0

  let queued = 0
  for (const recipient of fb.recipients) {
    const result = await enqueueReviewRequest(
      {
        projectId: fb.projectId,
        email: recipient.email,
        name: recipient.name,
        trigger: 'shipped',
        sourceId: feedbackId,
      },
      deps
    )
    if (result.queued) queued += 1
  }
  return queued
}

/**
 * After a changelog entry is published: enqueue `shipped` requests for the verified
 * recipients of each linked feedback item. `sourceId` is the feedback id, so an item
 * that already triggered through its status change is not asked twice.
 *
 * Recipients are loaded in one query, de-duplicated by address across the entry, and
 * capped at `MAX_CHANGELOG_RECIPIENTS` so one release cannot mail an unbounded audience.
 */
export async function enqueueForChangelogEntry(entryId: string, deps: ReviewServiceDeps = {}): Promise<number> {
  const store = deps.store ?? dbReviewsStore
  const entry = await store.loadChangelogFeedbackIds(entryId)
  if (!entry || entry.feedbackIds.length === 0) return 0

  const items = await store.loadFeedbackRecipients(entry.feedbackIds)
  const byId = new Map(items.map((item) => [item.feedbackId, item]))

  const targets: Array<{ feedbackId: string; email: string; name: string | null }> = []
  const seen = new Set<string>()
  let capped = false
  for (const feedbackId of entry.feedbackIds) {
    const item = byId.get(feedbackId)
    if (!item) continue
    for (const recipient of item.recipients) {
      const key = recipient.email.trim().toLowerCase()
      if (seen.has(key)) continue
      if (targets.length >= MAX_CHANGELOG_RECIPIENTS) {
        capped = true
        continue
      }
      seen.add(key)
      targets.push({ feedbackId, email: key, name: recipient.name })
    }
  }
  if (capped) logger.warn('Changelog review fan-out capped', { entryId, cap: MAX_CHANGELOG_RECIPIENTS })

  let queued = 0
  for (const target of targets) {
    const result = await enqueueReviewRequest(
      {
        projectId: entry.projectId,
        email: target.email,
        name: target.name,
        trigger: 'shipped',
        sourceId: target.feedbackId,
      },
      deps
    )
    if (result.queued) queued += 1
  }
  return queued
}

export interface ProcessSummary {
  /** Stale `sending` claims returned to the queue by the sweeper */
  recovered: number
  claimed: number
  sent: number
  skipped: number
  failed: number
  /** Transient failures put back in the queue with a backoff */
  retried: number
}

type FailureKind = 'permanent' | 'transient'

/**
 * SMTP 5xx (a rejected recipient, a rejected message) will not get better on retry.
 * Everything else - 4xx, timeouts, connection errors, and unaccepted results without a code - is transient.
 */
export function classifyFailure(input: { responseCode?: unknown; message?: string | null }): FailureKind {
  const code = typeof input.responseCode === 'number' ? input.responseCode : null
  if (code !== null) return code >= 500 && code < 600 ? 'permanent' : 'transient'
  const match = /\b([45]\d\d)\b/.exec(input.message ?? '')
  return match && match[1]!.startsWith('5') ? 'permanent' : 'transient'
}

/**
 * Sweep abandoned claims, then claim, guard, send and record each queued request.
 *
 * A claim is a short committed statement; nothing is locked while an email is in flight, and every
 * outcome is written per row, guarded by `status = 'sending'`.
 */
export async function processReviewRequests(
  options: { budgetMs?: number } = {},
  deps: ReviewServiceDeps = {}
): Promise<ProcessSummary> {
  const store = deps.store ?? dbReviewsStore
  const send = deps.sendEmail ?? sendMarketingReviewRequestEmail
  const clock = deps.now ?? (() => new Date())
  const baseUrl = (deps.baseUrl ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
  const deadline = clock().getTime() + (options.budgetMs ?? 45_000)
  const summary: ProcessSummary = { recovered: 0, claimed: 0, sent: 0, skipped: 0, failed: 0, retried: 0 }
  // `${projectId}:${email}` of every address sent in this run, so a second queued row for the
  // same person (another event, another source) cannot go out in the same run.
  const sentThisRun = new Set<string>()

  summary.recovered = await store.sweepStale(CLAIM_STALE_MINUTES, MAX_SEND_ATTEMPTS)

  for (;;) {
    const rows = await store.claimBatch(REVIEW_BATCH_SIZE)
    summary.claimed += rows.length

    const unprocessed = new Set(rows.map((row) => row.id))
    try {
      for (const row of rows) {
        // Out of time: the remaining claims are released below.
        if (clock().getTime() >= deadline) break
        unprocessed.delete(row.id)
        await processRow(row)
      }
    } finally {
      if (unprocessed.size > 0) await store.release([...unprocessed])
    }

    if (rows.length < REVIEW_BATCH_SIZE || clock().getTime() >= deadline) break
  }

  async function processRow(row: ClaimedReviewRequest): Promise<void> {
    const skip = async (reason: string) => {
      await store.markSkipped(row.id, reason)
      summary.skipped += 1
    }

    try {
      const settings = row.settings
      if (!settings || !settings.enabled) return await skip('disabled')
      if (!isMarketingOn(row)) return await skip('marketing_off')
      if (await store.isSuppressed(row.teamId, row.email)) return await skip('suppressed')

      const key = `${row.projectId}:${row.email}`
      if (sentThisRun.has(key)) return await skip('cooldown')
      // Committed state, checked right before sending: earlier sends of this run are already committed.
      const since = new Date(clock().getTime() - settings.cooldownDays * DAY_MS)
      if (await store.hasRecentSentRequest(row.projectId, row.email, since, row.id)) return await skip('cooldown')

      const token = encodeURIComponent(row.token)
      let failure: { kind: FailureKind; message: string; logged: Record<string, unknown> } | null = null
      try {
        const sendResult = await send({
          to: row.email,
          productName: row.projectName,
          name: row.name,
          trigger: row.trigger,
          feedbackTitle: row.feedbackTitle,
          platforms: settings.platforms.map((platform) => ({
            label: platform.label,
            url: `${baseUrl}/api/marketing/r/${token}/go?p=${encodeURIComponent(platform.id)}`,
          })),
          testimonialUrl: settings.askForTestimonial ? `${baseUrl}/testimonial/${token}` : null,
          unsubscribeUrl: `${baseUrl}/api/marketing/r/${token}/unsubscribe`,
        })
        // sendEmail reports transport failures as `{ accepted: false }` instead of throwing.
        if (sendResult && 'accepted' in sendResult && sendResult.accepted === false) {
          const message = sendResult.response || 'Email was not accepted'
          failure = { kind: classifyFailure({ message }), message, logged: { reason: 'not_accepted' } }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error'
        failure = {
          kind: classifyFailure({ responseCode: (error as { responseCode?: unknown })?.responseCode, message }),
          message,
          logged: describeError(error),
        }
      }

      if (!failure) {
        sentThisRun.add(key)
        await store.markSent(row.id, clock())
        summary.sent += 1
        return
      }

      const attempts = row.attempts + 1
      const stored = scrubEmails(failure.message)
      if (failure.kind === 'transient' && attempts < MAX_SEND_ATTEMPTS) {
        const delay = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)]!
        logger.warn('Review request will be retried', { requestId: row.id, attempts, ...failure.logged })
        await store.markRetry(row.id, stored, delay)
        summary.retried += 1
        return
      }
      logger.error('Review request failed', { requestId: row.id, attempts, kind: failure.kind, ...failure.logged })
      await store.markFailed(row.id, stored)
      summary.failed += 1
    } catch (error) {
      // A guard query or an outcome write failed. Never log the message: it may quote an address.
      logger.error('Review request processing error', { requestId: row.id, ...describeError(error) })
      try {
        await store.markFailed(row.id, 'Processing error')
        summary.failed += 1
      } catch {
        // Left in `sending`; the sweeper returns it to the queue.
      }
    }
  }

  logger.info('Review requests processed', { ...summary })
  return summary
}
