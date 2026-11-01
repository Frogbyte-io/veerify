/**
 * @openapi
 * /api/support/conversations/combined:
 *   get:
 *     tags: [Support]
 *     summary: List conversations across inboxes (All projects)
 *     operationId: listCombinedSupportConversations
 *     description: >
 *       One newest-first list over every inbox the caller can work in, across the projects in the
 *       current scope that have Inbox switched on. In single-project mode the scope is the active
 *       project. `projects` narrows it to some of them (an id outside the scope is 403). Same views,
 *       search, filters and cursor paging as `GET /api/support/conversations`.
 *     parameters:
 *       - in: query
 *         name: projects
 *         description: Comma-separated project ids (the project filter chips). Empty means every project in scope.
 *         schema: { type: string }
 *       - in: query
 *         name: view
 *         description: >
 *           Same values as `GET /api/support/conversations`. Spam and Trash are folders; every other
 *           view, the counts and search exclude them.
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
 *         schema: { type: string }
 *       - in: query
 *         name: tagId
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
 *           `conversations` carry the receiving address (`mailAddress`), `isUnread`, `project`
 *           (`{ id, name, slug }`) and `inbox` (`{ id, name }`). `projectCounts` maps every project in
 *           scope with Inbox on (including ones the project filter left out, and zeros) to the number
 *           of conversations the current view, search and filters match in it, so the chips keep their
 *           numbers while one is selected. `unreadCounts` are for the signed-in agent over the
 *           projects that are not filtered out (same meaning as in the single-inbox list, without
 *           `byAddress`). `inboxes` are the inboxes the list covers (for live updates) and
 *           `totalInboxes` counts every inbox the caller can work in across the scope, ignoring the
 *           project filter.
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
 *                     projectCounts: { type: object, additionalProperties: { type: integer } }
 *                     totalInboxes: { type: integer }
 *                     inboxes:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string }
 *                           name: { type: string }
 *                           projectId: { type: string }
 *                           emailAddress: { type: string, nullable: true }
 *                     unreadCounts:
 *                       type: object
 *                       properties:
 *                         unassigned: { type: integer }
 *                         assignedToMe: { type: integer }
 *                         inbox: { type: integer }
 *                         breachingSoon: { type: integer }
 *       400: { description: Invalid query or cursor }
 *       403: { description: A requested project is outside the current scope }
 */
import { z } from 'zod'
import { and, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import { resolveProjectModules } from '~/lib/modules'
import { createSuccessResponse } from '~/server/utils/response'
import { requireScopedProjects } from '~/server/utils/project-context'
import { listAccessibleInboxes } from '~/server/utils/support-access'
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
  breachingSoonConditions,
  conversationCursorCondition,
  conversationListConditions,
  conversationListFilterShape,
  unreadForViewerSql,
  viewerReadStateJoin,
} from '~/server/utils/support-conversation-list'

const querySchema = z.object(conversationListFilterShape)

export default defineEventHandler(async (event) => {
  const { session, projects, scopeProjects } = await requireScopedProjects(event, { module: 'supportEnabled' })
  const query = validateQuery(event, querySchema)
  const userId = session.user.id

  // `projects` is narrowed by the chips; the counts and `totalInboxes` look at every project with Inbox on.
  const inboxProjects = scopeProjects.filter(
    (p) => resolveProjectModules((p.settings ?? {}) as Record<string, unknown>).supportEnabled
  )
  const allInboxes = await listAccessibleInboxes(userId, inboxProjects)
  const chosen = new Set(projects.map((p) => p.id))
  const inboxes = allInboxes.filter((inbox) => chosen.has(inbox.projectId))

  const projectCounts: Record<string, number> = Object.fromEntries(inboxProjects.map((p) => [p.id, 0]))
  const emptyUnread = { unassigned: 0, assignedToMe: 0, inbox: 0, breachingSoon: 0 }
  if (allInboxes.length === 0) {
    return createSuccessResponse({
      conversations: [],
      hasMore: false,
      nextCursor: null,
      projectCounts,
      totalInboxes: 0,
      inboxes: [],
      unreadCounts: emptyUnread,
    })
  }

  const filterConditions = conversationListConditions(query, userId)
  const search = query.search?.trim()

  // Chip counts: what the view matches in each project, across every inbox the caller can work in.
  const countBase = db
    .select({ projectId: conversation.projectId, count: sql<number>`count(*)`.mapWith(Number) })
    .from(conversation)
  const countRows = await (search ? countBase.innerJoin(contact, eq(conversation.contactId, contact.id)) : countBase)
    .leftJoin(csatResponse, eq(csatResponse.conversationId, conversation.id))
    .where(
      and(
        inArray(
          conversation.inboxId,
          allInboxes.map((inbox) => inbox.id)
        ),
        ...filterConditions
      )
    )
    .groupBy(conversation.projectId)
  for (const row of countRows) projectCounts[row.projectId] = row.count

  if (inboxes.length === 0) {
    return createSuccessResponse({
      conversations: [],
      hasMore: false,
      nextCursor: null,
      projectCounts,
      totalInboxes: allInboxes.length,
      inboxes: [],
      unreadCounts: emptyUnread,
    })
  }

  const inboxIds = inboxes.map((inbox) => inbox.id)
  const conditions = [inArray(conversation.inboxId, inboxIds), ...filterConditions]
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
  const rows = await (search ? listBase.innerJoin(contact, eq(conversation.contactId, contact.id)) : listBase)
    .leftJoin(csatResponse, eq(csatResponse.conversationId, conversation.id))
    .leftJoin(projectMailAddress, eq(projectMailAddress.id, conversation.mailAddressId))
    .leftJoin(conversationReadState, viewerReadStateJoin(userId))
    .where(and(...conditions))
    .orderBy(desc(conversation.createdAt), desc(conversation.id))
    .limit(query.limit + 1)

  const hasMore = rows.length > query.limit
  const pageRows = hasMore ? rows.slice(0, query.limit) : rows
  const projectById = new Map(projects.map((p) => [p.id, p]))
  const inboxById = new Map(inboxes.map((inbox) => [inbox.id, inbox]))
  const items = pageRows.map((row) => {
    const rowProject = projectById.get(row.projectId)
    const rowInbox = inboxById.get(row.inboxId)
    return {
      ...row,
      isUnread: isConversationUnread(row, userId),
      project: rowProject ? { id: rowProject.id, name: rowProject.name, slug: rowProject.slug } : null,
      inbox: rowInbox ? { id: rowInbox.id, name: rowInbox.name } : null,
    }
  })

  const unreadForViewer = unreadForViewerSql()
  const [counts] = await db
    .select({
      unassigned:
        sql<number>`count(*) filter (where ${conversation.assigneeUserId} is null and ${conversation.status} in ('open', 'pending') and ${unreadForViewer})`.mapWith(
          Number
        ),
      assignedToMe:
        sql<number>`count(*) filter (where ${conversation.assigneeUserId} = ${userId} and ${conversation.status} in ('open', 'pending') and ${unreadForViewer})`.mapWith(
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
    .leftJoin(conversationReadState, viewerReadStateJoin(userId))
    .where(
      and(
        inArray(conversation.inboxId, inboxIds),
        folderCondition(undefined),
        query.mailAddressId ? eq(conversation.mailAddressId, query.mailAddressId) : undefined
      )
    )

  return createSuccessResponse({
    conversations: items,
    hasMore,
    nextCursor: hasMore
      ? encodeListCursor({
          createdAt: pageRows[pageRows.length - 1].createdAt,
          id: pageRows[pageRows.length - 1].id,
        })
      : null,
    projectCounts,
    totalInboxes: allInboxes.length,
    inboxes: inboxes.map((inbox) => ({
      id: inbox.id,
      name: inbox.name,
      projectId: inbox.projectId,
      emailAddress: inbox.emailAddress ?? null,
    })),
    unreadCounts: {
      unassigned: counts?.unassigned ?? 0,
      assignedToMe: counts?.assignedToMe ?? 0,
      inbox: counts?.inbox ?? 0,
      breachingSoon: counts?.breachingSoon ?? 0,
    },
  })
})
