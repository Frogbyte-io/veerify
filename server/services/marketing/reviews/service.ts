import { randomBytes, randomUUID } from 'node:crypto'
import { sendMarketingReviewRequestEmail } from '~/lib/email'
import { DEFAULT_TEAM_MODULES, resolveProductModules } from '~/lib/modules'
import type { ReviewRequestTrigger } from '~/server/database/schema/marketing'
import { createLogger } from '~/server/utils/logger'
import { dbReviewsStore } from './store'
import type { EnqueueResult, ReviewProjectContext, ReviewsStore } from './types'

const logger = createLogger('marketing-reviews')

const DAY_MS = 24 * 60 * 60 * 1000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const REVIEW_BATCH_SIZE = 50

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

function isMarketingOn(ctx: ReviewProjectContext): boolean {
  const teamOn = ctx.teamMarketingEnabled ?? DEFAULT_TEAM_MODULES.marketingEnabled
  return teamOn && resolveProductModules(ctx.projectSettings).marketingEnabled === true
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

  const inserted = await store.insertRequest({
    id: randomUUID(),
    projectId: ctx.projectId,
    teamId: ctx.teamId,
    email,
    name: input.name?.trim() ? input.name.trim().slice(0, 200) : null,
    trigger: input.trigger,
    sourceId: input.sourceId ?? null,
    token: generateReviewToken(),
  })
  return inserted ? { queued: true } : { queued: false, reason: 'duplicate' }
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

async function enqueueShippedForFeedback(
  feedbackId: string,
  deps: ReviewServiceDeps,
  statusGate: boolean
): Promise<number> {
  const store = deps.store ?? dbReviewsStore
  const fb = await store.loadFeedbackRecipients(feedbackId)
  if (!fb) return 0

  if (statusGate) {
    const ctx = await store.loadProjectContext(fb.projectId)
    if (!ctx?.settings || !ctx.settings.shippedStatusValues.includes(fb.status)) return 0
  }

  const recipients = new Map<string, string | null>()
  if (fb.author.email) recipients.set(fb.author.email.trim().toLowerCase(), fb.author.name)
  for (const email of fb.subscribers) {
    const key = email.trim().toLowerCase()
    if (!recipients.has(key)) recipients.set(key, null)
  }

  let queued = 0
  for (const [email, name] of recipients) {
    const result = await enqueueReviewRequest(
      { projectId: fb.projectId, email, name, trigger: 'shipped', sourceId: feedbackId },
      deps
    )
    if (result.queued) queued += 1
  }
  return queued
}

/** After a feedback status change: enqueue for the author and subscribers when the new status is a shipped one. */
export async function enqueueForFeedbackStatus(feedbackId: string, deps: ReviewServiceDeps = {}): Promise<number> {
  return enqueueShippedForFeedback(feedbackId, deps, true)
}

/**
 * After a changelog entry is published: enqueue `shipped` requests for each
 * linked feedback item. `sourceId` is the feedback id, so an item that already
 * triggered through its status change is not asked twice.
 */
export async function enqueueForChangelogEntry(entryId: string, deps: ReviewServiceDeps = {}): Promise<number> {
  const store = deps.store ?? dbReviewsStore
  const entry = await store.loadChangelogFeedbackIds(entryId)
  if (!entry) return 0
  let queued = 0
  for (const feedbackId of entry.feedbackIds) {
    queued += await enqueueShippedForFeedback(feedbackId, deps, false)
  }
  return queued
}

export interface ProcessSummary {
  claimed: number
  sent: number
  skipped: number
  failed: number
}

/** Claim queued requests, re-check the guards, send the email, and record the outcome. */
export async function processReviewRequests(
  options: { budgetMs?: number } = {},
  deps: ReviewServiceDeps = {}
): Promise<ProcessSummary> {
  const store = deps.store ?? dbReviewsStore
  const send = deps.sendEmail ?? sendMarketingReviewRequestEmail
  const clock = deps.now ?? (() => new Date())
  const baseUrl = (deps.baseUrl ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
  const deadline = clock().getTime() + (options.budgetMs ?? 45_000)
  const summary: ProcessSummary = { claimed: 0, sent: 0, skipped: 0, failed: 0 }

  for (;;) {
    let batchSize = 0
    await store.claimBatch(REVIEW_BATCH_SIZE, async (batch) => {
      batchSize = batch.rows.length
      summary.claimed += batch.rows.length

      for (const row of batch.rows) {
        // Out of time: leave the rest queued; the lock is released when the batch ends.
        if (clock().getTime() >= deadline) return

        try {
          const settings = row.settings
          if (!settings || !settings.enabled) {
            await batch.markSkipped(row.id, 'disabled')
            summary.skipped += 1
            continue
          }
          if (
            !isMarketingOn({
              projectId: row.projectId,
              teamId: row.teamId,
              projectSettings: row.projectSettings,
              teamMarketingEnabled: row.teamMarketingEnabled,
              settings,
            })
          ) {
            await batch.markSkipped(row.id, 'marketing_off')
            summary.skipped += 1
            continue
          }
          if (await store.isSuppressed(row.teamId, row.email)) {
            await batch.markSkipped(row.id, 'suppressed')
            summary.skipped += 1
            continue
          }
          const since = new Date(clock().getTime() - settings.cooldownDays * DAY_MS)
          if (await store.hasRecentSentRequest(row.projectId, row.email, since, row.id)) {
            await batch.markSkipped(row.id, 'cooldown')
            summary.skipped += 1
            continue
          }

          const token = encodeURIComponent(row.token)
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
            throw new Error(sendResult.response || 'Email was not accepted')
          }
          await batch.markSent(row.id, clock())
          summary.sent += 1
        } catch (error) {
          const message = error instanceof Error ? error.message : 'unknown error'
          logger.error('Review request failed', { requestId: row.id, error: message })
          await batch.markFailed(row.id, message)
          summary.failed += 1
        }
      }
    })

    if (batchSize < REVIEW_BATCH_SIZE || clock().getTime() >= deadline) break
  }

  logger.info('Review requests processed', { ...summary })
  return summary
}
