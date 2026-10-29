/**
 * @openapi
 * /api/support/conversations:
 *   get:
 *     tags: [Support]
 *     summary: List conversations in an inbox
 *     operationId: listSupportConversations
 *     parameters:
 *       - in: query
 *         name: inboxId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: view
 *         description: >
 *           `archived` is status closed. `spam` and `trash` are folders (`spamAt` /
 *           `deletedAt`); every other view, the counts and search exclude spam and
 *           trashed conversations. `spam` lists spam that is not in Trash.
 *         schema: { type: string, enum: [unassigned, assigned-to-me, resolved, breaching-soon, archived, spam, trash, all] }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: assigneeUserId
 *         schema: { type: string }
 *       - in: query
 *         name: contactId
 *         schema: { type: string }
 *       - in: query
 *         name: mailAddressId
 *         description: Only conversations that arrived on this receiving address
 *         schema: { type: string }
 *       - in: query
 *         name: tagId
 *         schema: { type: string }
 *       - in: query
 *         name: projectId
 *         schema: { type: string }
 *       - in: query
 *         name: csat
 *         schema: { type: string, enum: [rated, unrated] }
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 200 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *     responses:
 *       200: { description: Conversation page; each item carries `mailAddressId` and `mailAddress` (the receiving address, or null) }
 *       403: { description: Not a member of this inbox or a project admin }
 *       404: { description: Inbox not found }
 */
import { z } from 'zod'
import { and, desc, eq, getTableColumns, ilike, inArray, isNotNull, isNull, lte, lt, or, sql } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxAccess } from '~/server/utils/support-access'
import { validateQuery } from '~/server/utils/validation'
import { decodeListCursor, encodeListCursor } from '~/server/utils/list-cursor'
import { db } from '~/server/database/drizzle'
import {
  contact,
  conversation,
  conversationReadState,
  conversationTag,
  csatResponse,
  projectMailAddress,
} from '~/server/database/schema/support'
import { isConversationUnread } from '~/server/utils/conversation-read-state'
import { CONVERSATION_LIST_VIEWS, folderCondition } from '~/server/utils/support-trash'

const MAX_POSTGRES_INTEGER = 2147483647

const querySchema = z.object({
  inboxId: z.string().min(1),
  view: z.enum(CONVERSATION_LIST_VIEWS).optional(),
  status: z.enum(['open', 'pending', 'resolved', 'snoozed', 'closed']).optional(),
  assigneeUserId: z.string().optional(),
  contactId: z.string().optional(),
  mailAddressId: z.string().optional(),
  tagId: z.string().optional(),
  projectId: z.string().optional(),
  csat: z.enum(['rated', 'unrated']).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const query = validateQuery(event, querySchema)

  await requireInboxAccess(query.inboxId, session.user.id)

  const conditions = [eq(conversation.inboxId, query.inboxId), folderCondition(query.view)]
  const activeStatuses = ['open', 'pending'] as const
  const search = query.search?.trim()

  if (!search && query.view === 'unassigned') {
    conditions.push(isNull(conversation.assigneeUserId), inArray(conversation.status, activeStatuses))
  } else if (!search && query.view === 'assigned-to-me') {
    conditions.push(eq(conversation.assigneeUserId, session.user.id), inArray(conversation.status, activeStatuses))
  } else if (!search && query.view === 'resolved') {
    conditions.push(eq(conversation.status, 'resolved'))
  } else if (!search && query.view === 'archived') {
    conditions.push(eq(conversation.status, 'closed'))
  } else if (!search && query.view === 'breaching-soon') {
    const soon = new Date(Date.now() + 60 * 60_000)
    conditions.push(
      inArray(conversation.status, activeStatuses),
      isNull(conversation.slaPausedAt),
      or(
        and(isNotNull(conversation.firstResponseDueAt), lte(conversation.firstResponseDueAt, soon)),
        and(isNotNull(conversation.nextResponseDueAt), lte(conversation.nextResponseDueAt, soon)),
        and(isNotNull(conversation.resolutionDueAt), lte(conversation.resolutionDueAt, soon))
      )!
    )
  }

  if (query.status) conditions.push(eq(conversation.status, query.status))
  if (query.assigneeUserId) conditions.push(eq(conversation.assigneeUserId, query.assigneeUserId))
  if (query.contactId) conditions.push(eq(conversation.contactId, query.contactId))
  if (query.mailAddressId) conditions.push(eq(conversation.mailAddressId, query.mailAddressId))
  if (query.projectId) conditions.push(eq(conversation.projectId, query.projectId))

  if (query.csat === 'rated') conditions.push(isNotNull(csatResponse.rating))
  if (query.csat === 'unrated') conditions.push(isNull(csatResponse.rating))

  if (query.tagId) {
    conditions.push(
      inArray(
        conversation.id,
        db
          .select({ id: conversationTag.conversationId })
          .from(conversationTag)
          .where(eq(conversationTag.tagId, query.tagId))
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

  if (query.cursor) {
    const cursor = decodeListCursor(query.cursor, 'conversation')
    conditions.push(
      or(
        lt(conversation.createdAt, cursor.createdAt),
        and(eq(conversation.createdAt, cursor.createdAt), lt(conversation.id, cursor.id))
      )!
    )
  }

  const listBase = db
    .select({
      ...getTableColumns(conversation),
      mailAddress: projectMailAddress.address,
      lastReadAt: conversationReadState.lastReadAt,
      csatRating: csatResponse.rating,
      csatComment: csatResponse.comment,
      csatRespondedAt: csatResponse.respondedAt,
    })
    .from(conversation)

  const joinedListBase = search ? listBase.innerJoin(contact, eq(conversation.contactId, contact.id)) : listBase

  const rows = await joinedListBase
    .leftJoin(csatResponse, eq(csatResponse.conversationId, conversation.id))
    .leftJoin(projectMailAddress, eq(projectMailAddress.id, conversation.mailAddressId))
    .leftJoin(
      conversationReadState,
      and(eq(conversationReadState.conversationId, conversation.id), eq(conversationReadState.userId, session.user.id))
    )
    .where(and(...conditions))
    .orderBy(desc(conversation.createdAt), desc(conversation.id))
    .limit(query.limit + 1)

  const hasMore = rows.length > query.limit
  const pageRows = hasMore ? rows.slice(0, query.limit) : rows
  const items = pageRows.map((row) => ({
    ...row,
    isUnread: isConversationUnread(row, session.user.id),
  }))

  const unreadSignalAt = sql`coalesce(${conversation.lastCustomerReplyAt}, ${conversation.createdAt})`
  const unreadForViewer = sql`(${conversationReadState.lastReadAt} is null or ${conversationReadState.lastReadAt} < ${unreadSignalAt})`
  const [unreadCounts = { unassigned: 0, assignedToMe: 0 }] = await db
    .select({
      unassigned:
        sql<number>`count(*) filter (where ${conversation.assigneeUserId} is null and ${conversation.status} in ('open', 'pending') and ${unreadForViewer})`.mapWith(
          Number
        ),
      assignedToMe:
        sql<number>`count(*) filter (where ${conversation.assigneeUserId} = ${session.user.id} and ${conversation.status} in ('open', 'pending') and ${unreadForViewer})`.mapWith(
          Number
        ),
    })
    .from(conversation)
    .leftJoin(
      conversationReadState,
      and(eq(conversationReadState.conversationId, conversation.id), eq(conversationReadState.userId, session.user.id))
    )
    .where(and(eq(conversation.inboxId, query.inboxId), folderCondition(undefined)))

  return createSuccessResponse({
    conversations: items,
    hasMore,
    nextCursor: hasMore
      ? encodeListCursor({
          createdAt: pageRows[pageRows.length - 1].createdAt,
          id: pageRows[pageRows.length - 1].id,
        })
      : null,
    unreadCounts,
  })
})
