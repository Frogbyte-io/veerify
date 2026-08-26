import { and, desc, eq, lt, notExists, or } from 'drizzle-orm'

import { db } from '~/server/database/drizzle'
import { feedback, project } from '~/server/database/schema/feedback'
import { contactLink, type contact } from '~/server/database/schema/support'
import { decodeListCursor, encodeListCursor, type ListCursor } from './list-cursor'

export const DEFAULT_TIMELINE_LIMIT = 25
export const MAX_TIMELINE_LIMIT = 100

export interface ContactTimelineLink {
  entityType: string
  entityId: string
  [key: string]: unknown
}

export interface ProbableFeedback {
  id: string
  [key: string]: unknown
}

export interface TimelinePageOptions {
  limit?: number
  linkedHasMore?: boolean
  linkedNextCursor?: string | null
  probableHasMore?: boolean
  probableNextCursor?: string | null
}

export interface ContactTimelineQueryOptions {
  limit?: number
  linkedCursor?: string
  probableCursor?: string
}

type TimelineContact = Pick<typeof contact.$inferSelect, 'id' | 'teamId' | 'email' | 'userId'>

/**
 * Keep confirmed links authoritative while presenting heuristic matches as a
 * separate, suggestion-only section. A feedback item that was explicitly
 * linked must not be shown again as a probable match.
 */
export function buildContactTimeline<TLink extends ContactTimelineLink, TFeedback extends ProbableFeedback>(
  linked: TLink[],
  probableFeedback: TFeedback[],
  pageOptions?: TimelinePageOptions
): {
  linked: TLink[]
  probableFeedback: TFeedback[]
  linkedHasMore?: boolean
  linkedNextCursor?: string | null
  probableHasMore?: boolean
  probableNextCursor?: string | null
} {
  const linkedFeedbackIds = new Set(
    linked.filter((link) => link.entityType === 'feedback').map((link) => link.entityId)
  )

  const timeline = {
    linked,
    probableFeedback: probableFeedback.filter((feedback) => !linkedFeedbackIds.has(feedback.id)),
  }

  if (!pageOptions) return timeline

  return {
    ...timeline,
    linkedHasMore: pageOptions.linkedHasMore ?? false,
    linkedNextCursor: pageOptions.linkedNextCursor ?? null,
    probableHasMore: pageOptions.probableHasMore ?? false,
    probableNextCursor: pageOptions.probableNextCursor ?? null,
  }
}

function cursorCondition(
  createdAtColumn: typeof contactLink.createdAt | typeof feedback.createdAt,
  idColumn: typeof contactLink.id | typeof feedback.id,
  cursor: ListCursor
) {
  return or(
    lt(createdAtColumn, cursor.createdAt),
    and(eq(createdAtColumn, cursor.createdAt), lt(idColumn, cursor.id))
  )
}

function pageMetadata<T extends { createdAt: Date; id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]

  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeListCursor({ createdAt: last.createdAt, id: last.id }) : null,
  }
}

/**
 * Fetch the feedback-only contact timeline. The linked and probable queries
 * intentionally have separate cursors and page metadata so either section can
 * advance without changing the other section's position.
 */
export async function getContactTimeline(
  contact: TimelineContact,
  options: ContactTimelineQueryOptions = {}
) {
  const limit = options.limit ?? DEFAULT_TIMELINE_LIMIT
  const linkedCursor = options.linkedCursor ? decodeListCursor(options.linkedCursor, 'linked feedback') : null
  const probableCursor = options.probableCursor ? decodeListCursor(options.probableCursor, 'probable feedback') : null

  const linkedConditions = [eq(contactLink.contactId, contact.id), eq(contactLink.entityType, 'feedback')]
  if (linkedCursor) linkedConditions.push(cursorCondition(contactLink.createdAt, contactLink.id, linkedCursor)!)

  const linkedRows = await db
    .select()
    .from(contactLink)
    .where(and(...linkedConditions))
    .orderBy(desc(contactLink.createdAt), desc(contactLink.id))
    .limit(limit + 1)

  const matchConditions = []
  if (contact.email) matchConditions.push(eq(feedback.authorEmail, contact.email))
  if (contact.userId) matchConditions.push(eq(feedback.authorUserId, contact.userId))

  const probableConditions = [
    eq(project.teamId, contact.teamId),
    or(...matchConditions),
    notExists(
      db
        .select({ id: contactLink.id })
        .from(contactLink)
        .where(
          and(
            eq(contactLink.entityType, 'feedback'),
            eq(contactLink.entityId, feedback.id)
          )
        )
    ),
  ]
  if (probableCursor) probableConditions.push(cursorCondition(feedback.createdAt, feedback.id, probableCursor)!)

  const probableRows = matchConditions.length
    ? await db
        .select({ feedback, project: { id: project.id, name: project.name, slug: project.slug } })
        .from(feedback)
        .innerJoin(project, eq(project.id, feedback.projectId))
        .where(and(...probableConditions))
        .orderBy(desc(feedback.createdAt), desc(feedback.id))
        .limit(limit + 1)
    : []

  const linkedPage = pageMetadata(linkedRows, limit)
  const probablePage = pageMetadata(
    probableRows.map((row) => ({ ...row.feedback, project: row.project })),
    limit
  )

  return buildContactTimeline(linkedPage.items, probablePage.items, {
    linkedHasMore: linkedPage.hasMore,
    linkedNextCursor: linkedPage.nextCursor,
    probableHasMore: probablePage.hasMore,
    probableNextCursor: probablePage.nextCursor,
  })
}

export function isAutoLinkEnabled(settings: { autoLinkFeedback?: boolean } | null | undefined): boolean {
  return settings?.autoLinkFeedback === true
}
