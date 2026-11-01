import { z } from 'zod'
import { and, eq, ilike, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import {
  conversation,
  conversationReadState,
  conversationTag,
  csatResponse,
  contact,
} from '~/server/database/schema/support'
import { decodeListCursor } from '~/server/utils/list-cursor'
import { CONVERSATION_LIST_VIEWS, folderCondition } from '~/server/utils/support-trash'

/**
 * Filters shared by the single-inbox list (`GET /api/support/conversations`) and the combined list
 * over several inboxes (`GET /api/support/conversations/combined`, All projects).
 */

const MAX_POSTGRES_INTEGER = 2147483647

export const ACTIVE_STATUSES = ['open', 'pending'] as const

/** Open or pending, not paused, with a response or resolution due within the hour. */
export function breachingSoonConditions(now: Date) {
  const soon = new Date(now.getTime() + 60 * 60_000)
  return [
    inArray(conversation.status, ACTIVE_STATUSES),
    isNull(conversation.slaPausedAt),
    or(
      and(isNotNull(conversation.firstResponseDueAt), lte(conversation.firstResponseDueAt, soon)),
      and(isNotNull(conversation.nextResponseDueAt), lte(conversation.nextResponseDueAt, soon)),
      and(isNotNull(conversation.resolutionDueAt), lte(conversation.resolutionDueAt, soon))
    )!,
  ]
}

/** Query fields both list endpoints accept. */
export const conversationListFilterShape = {
  view: z.enum(CONVERSATION_LIST_VIEWS).optional(),
  status: z.enum(['open', 'pending', 'resolved', 'snoozed', 'closed']).optional(),
  assigneeUserId: z.string().optional(),
  contactId: z.string().optional(),
  mailAddressId: z.string().optional(),
  tagId: z.string().optional(),
  csat: z.enum(['rated', 'unrated']).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
}

export type ConversationListFilters = {
  view?: (typeof CONVERSATION_LIST_VIEWS)[number]
  status?: 'open' | 'pending' | 'resolved' | 'snoozed' | 'closed'
  assigneeUserId?: string
  contactId?: string
  mailAddressId?: string
  tagId?: string
  csat?: 'rated' | 'unrated'
  search?: string
}

/**
 * Conditions for a view, search and filters (not the inbox scope and not the cursor). The list query
 * must left-join `csatResponse`, and join `contact` when `search` is set.
 */
export function conversationListConditions(
  filters: ConversationListFilters,
  userId: string,
  now: Date = new Date()
): SQL[] {
  const conditions: SQL[] = [folderCondition(filters.view)]
  const search = filters.search?.trim()

  if (!search && filters.view === 'inbox') {
    conditions.push(inArray(conversation.status, ACTIVE_STATUSES))
  } else if (!search && filters.view === 'snoozed') {
    conditions.push(eq(conversation.status, 'snoozed'))
  } else if (!search && filters.view === 'unassigned') {
    conditions.push(isNull(conversation.assigneeUserId), inArray(conversation.status, ACTIVE_STATUSES))
  } else if (!search && filters.view === 'assigned-to-me') {
    conditions.push(eq(conversation.assigneeUserId, userId), inArray(conversation.status, ACTIVE_STATUSES))
  } else if (!search && filters.view === 'resolved') {
    conditions.push(eq(conversation.status, 'resolved'))
  } else if (!search && filters.view === 'archived') {
    conditions.push(eq(conversation.status, 'closed'))
  } else if (!search && filters.view === 'breaching-soon') {
    conditions.push(...breachingSoonConditions(now))
  }

  if (filters.status) conditions.push(eq(conversation.status, filters.status))
  if (filters.assigneeUserId) conditions.push(eq(conversation.assigneeUserId, filters.assigneeUserId))
  if (filters.contactId) conditions.push(eq(conversation.contactId, filters.contactId))
  if (filters.mailAddressId) conditions.push(eq(conversation.mailAddressId, filters.mailAddressId))

  if (filters.csat === 'rated') conditions.push(isNotNull(csatResponse.rating))
  if (filters.csat === 'unrated') conditions.push(isNull(csatResponse.rating))

  if (filters.tagId) {
    conditions.push(
      inArray(
        conversation.id,
        db
          .select({ id: conversationTag.conversationId })
          .from(conversationTag)
          .where(eq(conversationTag.tagId, filters.tagId))
      )
    )
  }

  if (search) {
    const pattern = `%${search}%`
    const searchConditions = [
      ilike(conversation.subject, pattern),
      ilike(contact.name, pattern),
      ilike(contact.email, pattern),
    ]
    const displayId = /^\d+$/.test(search) ? Number(search) : null
    if (displayId !== null && Number.isSafeInteger(displayId) && displayId <= MAX_POSTGRES_INTEGER) {
      searchConditions.push(eq(conversation.displayId, displayId))
    }
    conditions.push(or(...searchConditions)!)
  }

  return conditions
}

/** Keyset condition for `(createdAt desc, id desc)` pages; throws 400 for a malformed cursor. */
export function conversationCursorCondition(cursorValue: string): SQL {
  const cursor = decodeListCursor(cursorValue, 'conversation')
  return or(
    lt(conversation.createdAt, cursor.createdAt),
    and(eq(conversation.createdAt, cursor.createdAt), lt(conversation.id, cursor.id))
  )!
}

/** Read state of the viewer for each listed conversation. */
export function viewerReadStateJoin(userId: string) {
  return and(eq(conversationReadState.conversationId, conversation.id), eq(conversationReadState.userId, userId))
}

/** SQL: the conversation is unread for the viewer (same rule as the list's `isUnread`, ignoring other agents' ownership). */
export function unreadForViewerSql() {
  const unreadSignalAt = sql`coalesce(${conversation.lastCustomerReplyAt}, ${conversation.createdAt})`
  return sql`(${conversationReadState.lastReadAt} is null or ${conversationReadState.lastReadAt} < ${unreadSignalAt})`
}
