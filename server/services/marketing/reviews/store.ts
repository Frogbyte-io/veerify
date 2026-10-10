import { and, eq, gte, inArray, ne, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { user } from '~/server/database/schema/auth'
import { changelogEntry, changelogEntryFeedback } from '~/server/database/schema/changelog'
import { feedback, feedbackSubscription, project } from '~/server/database/schema/feedback'
import {
  marketingEmailSuppression,
  reviewRequest,
  reviewRequestSettings,
  type ReviewPlatform,
} from '~/server/database/schema/marketing'
import { contact, conversation, csatResponse, supportInbox } from '~/server/database/schema/support'
import { teamModuleSettings } from '~/server/database/schema/teams'
import type { ClaimedBatch, ClaimedReviewRequest, ReviewSettings, ReviewsStore } from './types'

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

export const dbReviewsStore: ReviewsStore = {
  async loadProjectContext(projectId) {
    const [row] = await db
      .select({
        projectId: project.id,
        teamId: project.teamId,
        projectSettings: project.settings,
        teamMarketingEnabled: teamModuleSettings.marketingEnabled,
        settings: reviewRequestSettings,
      })
      .from(project)
      .leftJoin(teamModuleSettings, eq(teamModuleSettings.teamId, project.teamId))
      .leftJoin(reviewRequestSettings, eq(reviewRequestSettings.projectId, project.id))
      .where(eq(project.id, projectId))
      .limit(1)
    if (!row) return null
    return {
      projectId: row.projectId,
      teamId: row.teamId,
      projectSettings: row.projectSettings,
      teamMarketingEnabled: row.teamMarketingEnabled,
      settings: row.settings ? toReviewSettings(row.settings) : null,
    }
  },

  async isSuppressed(teamId, email) {
    const [row] = await db
      .select({ email: marketingEmailSuppression.email })
      .from(marketingEmailSuppression)
      .where(and(eq(marketingEmailSuppression.teamId, teamId), eq(marketingEmailSuppression.email, email)))
      .limit(1)
    return Boolean(row)
  },

  async hasRecentRequest(projectId, email, since) {
    const [row] = await db
      .select({ id: reviewRequest.id })
      .from(reviewRequest)
      .where(
        and(
          eq(reviewRequest.projectId, projectId),
          eq(reviewRequest.email, email),
          inArray(reviewRequest.status, ['queued', 'sent']),
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
          eq(reviewRequest.email, email),
          eq(reviewRequest.status, 'sent'),
          gte(reviewRequest.sentAt, since),
          ne(reviewRequest.id, excludeId)
        )
      )
      .limit(1)
    return Boolean(row)
  },

  async insertRequest(row) {
    const inserted = await db
      .insert(reviewRequest)
      .values(row)
      .onConflictDoNothing()
      .returning({ id: reviewRequest.id })
    return inserted.length > 0
  },

  async claimBatch(limit, run) {
    await db.transaction(async (tx) => {
      const locked = await tx.execute<{ id: string }>(sql`
        SELECT id FROM review_request
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `)
      const ids = locked.rows.map((r) => r.id)
      if (ids.length === 0) {
        await run({ rows: [], markSent: async () => {}, markFailed: async () => {}, markSkipped: async () => {} })
        return
      }

      const rows = await tx
        .select({
          id: reviewRequest.id,
          projectId: reviewRequest.projectId,
          teamId: reviewRequest.teamId,
          email: reviewRequest.email,
          name: reviewRequest.name,
          trigger: reviewRequest.trigger,
          sourceId: reviewRequest.sourceId,
          token: reviewRequest.token,
          projectName: project.name,
          projectSettings: project.settings,
          teamMarketingEnabled: teamModuleSettings.marketingEnabled,
          settings: reviewRequestSettings,
          feedbackTitle: feedback.title,
        })
        .from(reviewRequest)
        .innerJoin(project, eq(project.id, reviewRequest.projectId))
        .leftJoin(teamModuleSettings, eq(teamModuleSettings.teamId, reviewRequest.teamId))
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

      const claimed: ClaimedReviewRequest[] = rows.map((row) => ({
        ...row,
        settings: row.settings ? toReviewSettings(row.settings) : null,
      }))

      const batch: ClaimedBatch = {
        rows: claimed,
        async markSent(id, at) {
          await tx
            .update(reviewRequest)
            .set({ status: 'sent', sentAt: at, error: null })
            .where(eq(reviewRequest.id, id))
        },
        async markFailed(id, error) {
          await tx
            .update(reviewRequest)
            .set({ status: 'failed', error: error.slice(0, 500) })
            .where(eq(reviewRequest.id, id))
        },
        async markSkipped(id, reason) {
          await tx.update(reviewRequest).set({ status: 'skipped', skipReason: reason }).where(eq(reviewRequest.id, id))
        },
      }
      await run(batch)
    })
  },

  async loadFeedbackRecipients(feedbackId) {
    const [row] = await db
      .select({
        projectId: feedback.projectId,
        status: feedback.status,
        title: feedback.title,
        authorEmail: feedback.authorEmail,
        authorName: feedback.authorName,
        userEmail: user.email,
        userName: user.name,
      })
      .from(feedback)
      .leftJoin(user, eq(user.id, feedback.authorUserId))
      .where(eq(feedback.id, feedbackId))
      .limit(1)
    if (!row) return null

    const subs = await db
      .select({ email: feedbackSubscription.email })
      .from(feedbackSubscription)
      .where(eq(feedbackSubscription.feedbackId, feedbackId))

    return {
      projectId: row.projectId,
      status: row.status,
      title: row.title,
      author: { email: row.authorEmail ?? row.userEmail ?? null, name: row.authorName ?? row.userName ?? null },
      subscribers: subs.map((s) => s.email),
    }
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
