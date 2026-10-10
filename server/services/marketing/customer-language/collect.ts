/**
 * Collects customer text for language analysis. Each function reads ONE
 * consented source for ONE product and nothing else; callers must check
 * consent before calling (service.ts does, at run time).
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm'
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

/** Feedback created from a support conversation carries this marker in `metadata.source`. */
export const SUPPORT_FEEDBACK_SOURCE = 'support_conversation'

const isSupportDerived = sql`coalesce(${feedback.metadata}->>'source', '') = ${SUPPORT_FEEDBACK_SOURCE}`

export interface CollectFeedbackOptions {
  /**
   * Include feedback derived from support conversations (and its comments),
   * labelled as support text. Only true when the team consented to support text.
   */
  includeSupportDerived?: boolean
}

/**
 * Feedback title + body, and public (non-internal) comments, for the product,
 * newest first. Hidden feedback is never read. Support-derived feedback is
 * excluded unless `includeSupportDerived`, in which case it counts as support.
 */
export async function collectFeedbackItems(
  projectId: string,
  since: Date,
  options: CollectFeedbackOptions = {}
): Promise<DatedItem[]> {
  const origin = options.includeSupportDerived ? undefined : sql`not ${isSupportDerived}`

  const posts = await db
    .select({
      title: feedback.title,
      body: feedback.body,
      createdAt: feedback.createdAt,
      supportDerived: isSupportDerived.mapWith(Boolean),
    })
    .from(feedback)
    .where(and(eq(feedback.projectId, projectId), eq(feedback.isHidden, false), origin, gte(feedback.createdAt, since)))
    .orderBy(desc(feedback.createdAt))
    .limit(SOURCE_LIMIT)

  const comments = await db
    .select({
      body: feedbackComment.body,
      createdAt: feedbackComment.createdAt,
      supportDerived: isSupportDerived.mapWith(Boolean),
    })
    .from(feedbackComment)
    .innerJoin(feedback, eq(feedback.id, feedbackComment.feedbackId))
    .where(
      and(
        eq(feedback.projectId, projectId),
        eq(feedback.isHidden, false),
        origin,
        eq(feedbackComment.isInternal, false),
        gte(feedbackComment.createdAt, since)
      )
    )
    .orderBy(desc(feedbackComment.createdAt))
    .limit(SOURCE_LIMIT)

  const sourceOf = (supportDerived: boolean) => (supportDerived ? ('support' as const) : ('feedback' as const))
  return [
    ...posts.map((p) => ({
      source: sourceOf(p.supportDerived),
      text: p.body ? `${p.title}. ${p.body}` : p.title,
      createdAt: p.createdAt,
    })),
    ...comments.map((c) => ({ source: sourceOf(c.supportDerived), text: c.body, createdAt: c.createdAt })),
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
