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
 *           `inbox` is every open or pending conversation, whoever it is assigned to
 *           (the default view in the UI); `snoozed` is status snoozed; `all` is
 *           every conversation in the normal folder. `archived` is status closed.
 *           `spam` and `trash` are folders (`spamAt` /
 *           `deletedAt`); every other view, the counts and search exclude spam and
 *           trashed conversations. `spam` lists spam that is not in Trash.
 *         schema: { type: string, enum: [inbox, snoozed, unassigned, assigned-to-me, resolved, breaching-soon, archived, spam, trash, all] }
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
 *       200:
 *         description: >
 *           Conversation page; each item carries `mailAddressId` and `mailAddress` (the receiving
 *           address, or null). `unreadCounts` are for the signed-in agent and cover the normal folder
 *           (no spam or trash): `unassigned` and `assignedToMe` count unread open or pending
 *           conversations, `inbox` all unread open or pending ones, and `breachingSoon` counts open or
 *           pending conversations (read or not) whose SLA is breaching within the hour. These four are
 *           limited to `mailAddressId` when it is given. `byAddress` maps each receiving address id to
 *           its unread open or pending conversations and is never limited by `mailAddressId`.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     conversations: { type: array, items: { type: object } }
 *                     hasMore: { type: boolean }
 *                     nextCursor: { type: string, nullable: true }
 *                     unreadCounts:
 *                       type: object
 *                       properties:
 *                         unassigned: { type: integer }
 *                         assignedToMe: { type: integer }
 *                         inbox: { type: integer }
 *                         breachingSoon: { type: integer }
 *                         byAddress: { type: object, additionalProperties: { type: integer } }
 *       403: { description: Not a member of this inbox or a project admin }
 *       404: { description: Inbox not found }
 */
import { z } from 'zod'
import { and, desc, eq, getTableColumns, inArray, isNotNull, sql } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireInboxAccess } from '~/server/utils/support-access'
import { validateQuery } from '~/server/utils/validation'
import { encodeListCursor } from '~/server/utils/list-cursor'
import { db } from '~/server/database/drizzle'
import {
  contact,
  conversation,
  conversationReadState,
  csatResponse,
  projectMailAddress,
} from '~/server/database/schema/support'
import { isConversationUnread } from '~/server/utils/conversation-read-state'
import { folderCondition } from '~/server/utils/support-trash'
import {
  ACTIVE_STATUSES,
  breachingSoonConditions,
  conversationCursorCondition,
  conversationListConditions,
  conversationListFilterShape,
} from '~/server/utils/support-conversation-list'

const querySchema = z.object({
  inboxId: z.string().min(1),
  projectId: z.string().optional(),
  ...conversationListFilterShape,
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const query = validateQuery(event, querySchema)

  await requireInboxAccess(query.inboxId, session.user.id)

  const activeStatuses = ACTIVE_STATUSES
  const search = query.search?.trim()
  const conditions = [eq(conversation.inboxId, query.inboxId), ...conversationListConditions(query, session.user.id)]
  if (query.projectId) conditions.push(eq(conversation.projectId, query.projectId))
  if (query.cursor) conditions.push(conversationCursorCondition(query.cursor))

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
  const readStateJoin = and(
    eq(conversationReadState.conversationId, conversation.id),
    eq(conversationReadState.userId, session.user.id)
  )
  const inboxFolder = [eq(conversation.inboxId, query.inboxId), folderCondition(undefined)]
  const [counts] = await db
    .select({
      unassigned:
        sql<number>`count(*) filter (where ${conversation.assigneeUserId} is null and ${conversation.status} in ('open', 'pending') and ${unreadForViewer})`.mapWith(
          Number
        ),
      assignedToMe:
        sql<number>`count(*) filter (where ${conversation.assigneeUserId} = ${session.user.id} and ${conversation.status} in ('open', 'pending') and ${unreadForViewer})`.mapWith(
          Number
        ),
      inbox:
        sql<number>`count(*) filter (where ${conversation.status} in ('open', 'pending') and ${unreadForViewer})`.mapWith(
          Number
        ),
      // A count of what is breaching, read or not, not of unread conversations.
      breachingSoon: sql<number>`count(*) filter (where ${and(...breachingSoonConditions(new Date()))})`.mapWith(
        Number
      ),
    })
    .from(conversation)
    .leftJoin(conversationReadState, readStateJoin)
    .where(and(...inboxFolder, query.mailAddressId ? eq(conversation.mailAddressId, query.mailAddressId) : undefined))

  // Per receiving address, deliberately not narrowed by `mailAddressId`: the
  // address list shows every address's badge while one of them is selected.
  const byAddressRows = await db
    .select({
      mailAddressId: conversation.mailAddressId,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(conversation)
    .leftJoin(conversationReadState, readStateJoin)
    .where(
      and(
        ...inboxFolder,
        isNotNull(conversation.mailAddressId),
        inArray(conversation.status, activeStatuses),
        unreadForViewer
      )
    )
    .groupBy(conversation.mailAddressId)
  const byAddress: Record<string, number> = {}
  for (const row of byAddressRows) {
    if (row.mailAddressId) byAddress[row.mailAddressId] = row.count
  }

  const unreadCounts = {
    unassigned: counts?.unassigned ?? 0,
    assignedToMe: counts?.assignedToMe ?? 0,
    inbox: counts?.inbox ?? 0,
    breachingSoon: counts?.breachingSoon ?? 0,
    byAddress,
  }

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
