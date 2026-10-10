/**
 * Collects customer text for language analysis. Each function reads ONE
 * consented source for ONE product and nothing else; callers must check
 * consent before calling (service.ts does, at run time).
 */

import { and, desc, eq, gte } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackComment } from '~/server/database/schema/feedback'
import { conversation, conversationMessage } from '~/server/database/schema/support'
import type { LanguageItem } from './prompt'

export const LANGUAGE_WINDOW_DAYS = 90
/** Per-source read cap; prepareLanguageInput applies the final 300-item cap. */
const SOURCE_LIMIT = 300

export interface DatedItem extends LanguageItem {
  createdAt: Date
}

export function languageWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - LANGUAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
}

/** Feedback title + body, and public (non-internal) comments, for the product, newest first. */
export async function collectFeedbackItems(projectId: string, since: Date): Promise<DatedItem[]> {
  const posts = await db
    .select({ title: feedback.title, body: feedback.body, createdAt: feedback.createdAt })
    .from(feedback)
    .where(and(eq(feedback.projectId, projectId), gte(feedback.createdAt, since)))
    .orderBy(desc(feedback.createdAt))
    .limit(SOURCE_LIMIT)

  const comments = await db
    .select({ body: feedbackComment.body, createdAt: feedbackComment.createdAt })
    .from(feedbackComment)
    .innerJoin(feedback, eq(feedback.id, feedbackComment.feedbackId))
    .where(
      and(
        eq(feedback.projectId, projectId),
        eq(feedbackComment.isInternal, false),
        gte(feedbackComment.createdAt, since)
      )
    )
    .orderBy(desc(feedbackComment.createdAt))
    .limit(SOURCE_LIMIT)

  return [
    ...posts.map((p) => ({
      source: 'feedback' as const,
      text: p.body ? `${p.title}. ${p.body}` : p.title,
      createdAt: p.createdAt,
    })),
    ...comments.map((c) => ({ source: 'feedback' as const, text: c.body, createdAt: c.createdAt })),
  ]
}

/**
 * Incoming customer messages only, for conversations attributed to this
 * product (`conversation.projectId`, the resolved product) within the team.
 * Notes, outgoing agent replies, private and system rows are excluded in the
 * query and again on the returned rows. Reads the plain-text `body`, never
 * `bodyHtml`.
 */
export async function collectSupportItems(teamId: string, projectId: string, since: Date): Promise<DatedItem[]> {
  const rows = await db
    .select({
      body: conversationMessage.body,
      kind: conversationMessage.kind,
      senderKind: conversationMessage.senderKind,
      isPrivate: conversationMessage.isPrivate,
      createdAt: conversationMessage.createdAt,
    })
    .from(conversationMessage)
    .innerJoin(conversation, eq(conversation.id, conversationMessage.conversationId))
    .where(
      and(
        eq(conversation.teamId, teamId),
        eq(conversation.projectId, projectId),
        eq(conversationMessage.kind, 'incoming'),
        eq(conversationMessage.senderKind, 'contact'),
        eq(conversationMessage.isPrivate, false),
        gte(conversationMessage.createdAt, since)
      )
    )
    .orderBy(desc(conversationMessage.createdAt))
    .limit(SOURCE_LIMIT)

  return rows
    .filter((r) => r.kind === 'incoming' && r.senderKind === 'contact' && !r.isPrivate && Boolean(r.body?.trim()))
    .map((r) => ({ source: 'support' as const, text: r.body as string, createdAt: r.createdAt }))
}
