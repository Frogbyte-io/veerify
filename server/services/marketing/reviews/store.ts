import { and, count, eq, gte, inArray, ne, or, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { user } from '~/server/database/schema/auth'
import { changelogEntry, changelogEntryFeedback } from '~/server/database/schema/changelog'
import { feedback, feedbackSubscription, project } from '~/server/database/schema/feedback'
import {
  marketingEmailSuppression,
  reviewRequest,
  reviewRequestSettings,
  type ReviewPlatform,
  type ReviewRequestStatus,
} from '~/server/database/schema/marketing'
import { contact, conversation, csatResponse, supportInbox } from '~/server/database/schema/support'
import { hashEmail, hashEmailCandidates } from '~/server/utils/marketing-email-hash'
import type { ReviewSettings, ReviewsStore } from './types'

/**
 * Statuses that occupy the cooldown. `failed` and `skipped` do not: the person was never contacted,
 * so a later event may ask them. The unique (project, trigger, source, email) slot of a failed row
 * stays taken though, so the same event is never re-queued after it failed for good.
 */
const ACTIVE_STATUSES: ReviewRequestStatus[] = ['queued', 'sending', 'sent']

export function toReviewSettings(row: typeof reviewRequestSettings.$inferSelect): ReviewSettings {
  return {
    enabled: row.enabled,
    platforms: (row.platforms ?? []) as ReviewPlatform[],
    askForTestimonial: row.askForTestimonial,
    csatTrigger: row.csatTrigger,
    csatMinRating: row.csatMinRating,
    shippedTrigger: row.shippedTrigger,
    shippedStatusValues: row.shippedStatusValues ?? [],
    cooldownDays: row.cooldownDays,
  }
}

/** Matches a request row by address or, once anonymised, by the keyed hash of it. */
function requestEmailMatches(email: string) {
  return or(eq(reviewRequest.email, email), inArray(reviewRequest.emailHash, hashEmailCandidates(email)))
}

export const dbReviewsStore: ReviewsStore = {
  async loadProjectContext(projectId) {
    const [row] = await db
      .select({
        projectId: project.id,
        organizationId: project.organizationId,
        projectSettings: project.settings,
        settings: reviewRequestSettings,
      })
      .from(project)
      .leftJoin(reviewRequestSettings, eq(reviewRequestSettings.projectId, project.id))
      .where(eq(project.id, projectId))
      .limit(1)
    if (!row) return null
    return {
      projectId: row.projectId,
      organizationId: row.organizationId,
      projectSettings: row.projectSettings,
      settings: row.settings ? toReviewSettings(row.settings) : null,
    }
  },

  async isSuppressed(organizationId, email) {
    const [row] = await db
      .select({ email: marketingEmailSuppression.email })
      .from(marketingEmailSuppression)
      .where(
        and(
          eq(marketingEmailSuppression.organizationId, organizationId),
          or(
            eq(marketingEmailSuppression.email, email),
            inArray(marketingEmailSuppression.emailHash, hashEmailCandidates(email))
          )
        )
      )
      .limit(1)
    return Boolean(row)
  },

  async stillSendable(id, organizationId, email) {
    const [row] = await db
      .select({ id: reviewRequest.id })
      .from(reviewRequest)
      .where(and(eq(reviewRequest.id, id), eq(reviewRequest.status, 'sending')))
      .limit(1)
    if (!row) return false
    return !(await dbReviewsStore.isSuppressed(organizationId, email))
  },

  async hasRecentRequest(projectId, email, since) {
    const [row] = await db
      .select({ id: reviewRequest.id })
      .from(reviewRequest)
      .where(
        and(
          eq(reviewRequest.projectId, projectId),
          requestEmailMatches(email),
          inArray(reviewRequest.status, ACTIVE_STATUSES),
          gte(reviewRequest.createdAt, since)
        )
      )
      .limit(1)
    return Boolean(row)
  },

  async hasRecentSentRequest(projectId, email, since, excludeId) {
    const [row] = await db
      .select({ id: reviewRequest.id })
      .from(reviewRequest)
      .where(
        and(
          eq(reviewRequest.projectId, projectId),
          requestEmailMatches(email),
          eq(reviewRequest.status, 'sent'),
          gte(reviewRequest.sentAt, since),
          ne(reviewRequest.id, excludeId)
        )
      )
      .limit(1)
    return Boolean(row)
  },

  async insertRequest(input, options) {
    const row = { ...input, emailHash: hashEmail(input.email) }
    const insert = (executor: Pick<typeof db, 'insert'>) =>
      executor.insert(reviewRequest).values(row).onConflictDoNothing().returning({ id: reviewRequest.id })

    if (!options?.dedupeSince) return (await insert(db)).length > 0

    // Manual requests have no source id, so the unique index cannot stop two of them for one
    // address. Serialize on (product, address) and re-check inside the lock instead.
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`review:${row.projectId}:${row.email}`}))`)
      const [existing] = await tx
        .select({ id: reviewRequest.id })
        .from(reviewRequest)
        .where(
          and(
            eq(reviewRequest.projectId, row.projectId),
            requestEmailMatches(row.email),
            inArray(reviewRequest.status, ACTIVE_STATUSES),
            gte(reviewRequest.createdAt, options.dedupeSince!)
          )
        )
        .limit(1)
      if (existing) return false
      return (await insert(tx)).length > 0
    })
  },

  async countManualSince(projectId, since) {
    const [row] = await db
      .select({ total: count() })
      .from(reviewRequest)
      .where(
        and(
          eq(reviewRequest.projectId, projectId),
          eq(reviewRequest.trigger, 'manual'),
          gte(reviewRequest.createdAt, since)
        )
      )
    return Number(row?.total ?? 0)
  },

  async sweepStale(staleAfterMinutes, maxAttempts) {
    const swept = await db.execute<{ id: string }>(sql`
      UPDATE review_request
      SET status = CASE WHEN attempts + 1 >= ${maxAttempts} THEN 'failed' ELSE 'queued' END,
          attempts = attempts + 1,
          claimed_at = NULL,
          next_attempt_at = NULL,
          error = 'Sending timed out'
      WHERE status = 'sending'
        AND claimed_at < now() - make_interval(mins => ${staleAfterMinutes})
      RETURNING id
    `)
    return swept.rows.length
  },

  async claimBatch(limit) {
    // One statement, committed on return: the row locks are released before anything is sent.
    const claimedIds = await db.execute<{ id: string }>(sql`
      UPDATE review_request
      SET status = 'sending', claimed_at = now()
      WHERE id IN (
        SELECT id FROM review_request
        WHERE status = 'queued'
          AND (next_attempt_at IS NULL OR next_attempt_at <= now())
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `)
    const ids = claimedIds.rows.map((r) => r.id)
    if (ids.length === 0) return []

    const rows = await db
      .select({
        id: reviewRequest.id,
        projectId: reviewRequest.projectId,
        organizationId: project.organizationId,
        email: reviewRequest.email,
        name: reviewRequest.name,
        trigger: reviewRequest.trigger,
        sourceId: reviewRequest.sourceId,
        token: reviewRequest.token,
        attempts: reviewRequest.attempts,
        projectName: project.name,
        projectSettings: project.settings,
        settings: reviewRequestSettings,
        feedbackTitle: feedback.title,
      })
      .from(reviewRequest)
      .innerJoin(project, eq(project.id, reviewRequest.projectId))
      .leftJoin(reviewRequestSettings, eq(reviewRequestSettings.projectId, reviewRequest.projectId))
      .leftJoin(
        feedback,
        and(
          eq(reviewRequest.trigger, 'shipped'),
          eq(feedback.id, reviewRequest.sourceId),
          eq(feedback.projectId, reviewRequest.projectId)
        )
      )
      .where(inArray(reviewRequest.id, ids))
      .orderBy(reviewRequest.createdAt)

    return rows.map((row) => ({
      ...row,
      settings: row.settings ? toReviewSettings(row.settings) : null,
    }))
  },

  async markSent(id, at) {
    await db
      .update(reviewRequest)
      .set({ status: 'sent', sentAt: at, error: null, claimedAt: null })
      .where(and(eq(reviewRequest.id, id), eq(reviewRequest.status, 'sending')))
  },

  async markFailed(id, error) {
    await db
      .update(reviewRequest)
      .set({
        status: 'failed',
        error: error.slice(0, 500),
        attempts: sql`${reviewRequest.attempts} + 1`,
        claimedAt: null,
      })
      .where(and(eq(reviewRequest.id, id), eq(reviewRequest.status, 'sending')))
  },

  async markSkipped(id, reason) {
    await db
      .update(reviewRequest)
      .set({ status: 'skipped', skipReason: reason, claimedAt: null })
      .where(and(eq(reviewRequest.id, id), eq(reviewRequest.status, 'sending')))
  },

  async markRetry(id, error, delayMs) {
    // The delay is applied in SQL so it is measured on the same clock as the claim query's now().
    await db
      .update(reviewRequest)
      .set({
        status: 'queued',
        error: error.slice(0, 500),
        attempts: sql`${reviewRequest.attempts} + 1`,
        nextAttemptAt: sql`now() + make_interval(secs => ${Math.round(delayMs / 1000)})`,
        claimedAt: null,
      })
      .where(and(eq(reviewRequest.id, id), eq(reviewRequest.status, 'sending')))
  },

  async release(ids) {
    if (ids.length === 0) return
    await db
      .update(reviewRequest)
      .set({ status: 'queued', claimedAt: null })
      .where(and(inArray(reviewRequest.id, ids), eq(reviewRequest.status, 'sending')))
  },

  async loadFeedbackRecipients(feedbackIds) {
    if (feedbackIds.length === 0) return []

    // Only verified addresses are ever contacted: `feedback.authorEmail` and a subscription's
    // `email` are free text that anyone can type, so they are not used. A recipient is a user
    // with `emailVerified = true`, addressed at the user's own email.
    const items = await db
      .select({
        feedbackId: feedback.id,
        projectId: feedback.projectId,
        status: feedback.status,
        title: feedback.title,
        authorEmail: user.email,
        authorName: user.name,
        authorVerified: user.emailVerified,
      })
      .from(feedback)
      .leftJoin(user, eq(user.id, feedback.authorUserId))
      .where(inArray(feedback.id, feedbackIds))

    // The subscription flow has no confirmation step for anonymous addresses (they are only
    // sent an unsubscribe notice), so a subscription counts only when linked to a verified account.
    const subs = await db
      .select({ feedbackId: feedbackSubscription.feedbackId, email: user.email, name: user.name })
      .from(feedbackSubscription)
      .innerJoin(user, and(eq(user.id, feedbackSubscription.userId), eq(user.emailVerified, true)))
      .where(inArray(feedbackSubscription.feedbackId, feedbackIds))

    const subsByFeedback = new Map<string, Array<{ email: string; name: string | null }>>()
    for (const sub of subs) {
      const list = subsByFeedback.get(sub.feedbackId) ?? []
      list.push({ email: sub.email, name: sub.name })
      subsByFeedback.set(sub.feedbackId, list)
    }

    return items.map((item) => {
      const seen = new Set<string>()
      const recipients: Array<{ email: string; name: string | null }> = []
      const add = (email: string | null, name: string | null) => {
        const key = email?.trim().toLowerCase()
        if (!key || seen.has(key)) return
        seen.add(key)
        recipients.push({ email: key, name })
      }
      if (item.authorVerified === true) add(item.authorEmail, item.authorName)
      for (const sub of subsByFeedback.get(item.feedbackId) ?? []) add(sub.email, sub.name)
      return {
        feedbackId: item.feedbackId,
        projectId: item.projectId,
        status: item.status,
        title: item.title,
        recipients,
      }
    })
  },

  async loadCsatContext(responseId) {
    const [row] = await db
      .select({
        rating: csatResponse.rating,
        scale: csatResponse.scale,
        contactEmail: contact.email,
        contactName: contact.name,
        conversationProjectId: conversation.projectId,
        inboxProjectId: supportInbox.projectId,
      })
      .from(csatResponse)
      .innerJoin(conversation, eq(conversation.id, csatResponse.conversationId))
      .innerJoin(contact, eq(contact.id, csatResponse.contactId))
      .innerJoin(supportInbox, eq(supportInbox.id, conversation.inboxId))
      .where(eq(csatResponse.id, responseId))
      .limit(1)
    if (!row) return null
    return {
      rating: row.rating,
      scale: row.scale,
      contactEmail: row.contactEmail,
      contactName: row.contactName,
      projectId: row.conversationProjectId ?? row.inboxProjectId ?? null,
    }
  },

  async loadChangelogFeedbackIds(entryId) {
    const [entry] = await db
      .select({ projectId: changelogEntry.projectId, status: changelogEntry.status })
      .from(changelogEntry)
      .where(eq(changelogEntry.id, entryId))
      .limit(1)
    if (!entry || entry.status !== 'published') return null

    const links = await db
      .select({ feedbackId: changelogEntryFeedback.feedbackId })
      .from(changelogEntryFeedback)
      .innerJoin(feedback, eq(feedback.id, changelogEntryFeedback.feedbackId))
      .where(and(eq(changelogEntryFeedback.entryId, entryId), eq(feedback.projectId, entry.projectId)))
    return { projectId: entry.projectId, feedbackIds: links.map((l) => l.feedbackId) }
  },
}
