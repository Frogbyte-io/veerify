/**
 * @openapi
 * /api/feedback:
 *   get:
 *     tags: [Feedback]
 *     summary: List feedback
 *     description: >
 *       Lists feedback for one or more projects, pinned items first. Authentication is optional: anonymous callers are accepted subject to public project and product rules. Signed-in callers may use a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *       Project members see everything in their projects; others see only non-hidden items of public products of public projects.
 *     operationId: listFeedback
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *       - {}
 *     parameters:
 *       - in: query
 *         name: projectId
 *         description: "Project id. Either projectId or projectIds is required"
 *         schema: { type: string, minLength: 1 }
 *       - in: query
 *         name: projectIds
 *         description: "Comma-separated project ids. Either projectId or projectIds is required"
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         description: "A status value of the project (the system statuses open, in_progress, planned, completed, closed, declined, or a custom status value)"
 *         schema: { type: string, minLength: 1, maxLength: 100 }
 *       - in: query
 *         name: categoryId
 *         schema: { type: string }
 *       - in: query
 *         name: productId
 *         schema: { type: string, minLength: 1 }
 *       - in: query
 *         name: search
 *         description: "Case-insensitive match on title or body"
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [createdAt, updatedAt, voteCount, title], default: voteCount }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *     responses:
 *       200: { description: "Paginated list: data.items and data.pagination (page, limit, total, totalPages)" }
 *       400: { description: "Validation failed (for example neither projectId nor projectIds given)" }
 *       401: { description: "Invalid personal API key" }
 *       403: { description: "No access to a requested project" }
 *       404: { description: "Project not found" }
 */
import { z } from 'zod'
import { eq, and, desc, asc, count, or, ilike } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { getAnonSession } from '~/server/utils/anonymous-session'
import { validateQuery } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory, githubIssueLink, product, project, vote } from '~/server/database/schema/feedback'
import { resolveFeedbackListScope } from '~/server/utils/feedback-access'
import { redactClientMetadata, stripApiKeyId } from '~/server/utils/feedback-source'

const listFeedbackQuerySchema = z
  .object({
    projectId: z.string().min(1).optional(),
    projectIds: z
      .string()
      .optional()
      .transform((value) =>
        value
          ? value
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean)
          : []
      ),
    status: z.string().trim().min(1).max(100).optional(),
    categoryId: z.string().optional(),
    productId: z.string().min(1).optional(),
    search: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    sortBy: z.enum(['createdAt', 'updatedAt', 'voteCount', 'title']).default('voteCount'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine((data) => Boolean(data.projectId) || data.projectIds.length > 0, {
    message: 'Project ID is required',
    path: ['projectId'],
  })

export default defineEventHandler(async (event) => {
  const session = await optionalAuth(event)
  const anonSession = !session?.user ? await getAnonSession(event) : null
  const query = validateQuery(event, listFeedbackQuerySchema)
  const requestedProjectIds = query.projectIds.length > 0 ? query.projectIds : query.projectId ? [query.projectId] : []

  // Access check: members see everything in their projects; everyone else only
  // non-hidden items of public products of public projects.
  const { condition: scopeCondition, memberProjectIds } = await resolveFeedbackListScope(
    requestedProjectIds,
    session?.user?.id ?? null
  )

  const conditions = [scopeCondition]
  if (query.productId) conditions.push(eq(feedback.productId, query.productId))
  if (query.status) conditions.push(eq(feedback.status, query.status))
  if (query.categoryId) conditions.push(eq(feedback.categoryId, query.categoryId))
  if (query.search) {
    const term = `%${query.search}%`
    conditions.push(or(ilike(feedback.title, term), ilike(feedback.body, term))!)
  }

  const whereClause = and(...conditions)

  // Sort
  const sortColumn = {
    createdAt: feedback.createdAt,
    updatedAt: feedback.updatedAt,
    voteCount: feedback.voteCount,
    title: feedback.title,
  }[query.sortBy]
  const orderFn = query.sortOrder === 'asc' ? asc : desc

  // Get total count
  const [totalResult] = await db.select({ count: count() }).from(feedback).where(whereClause)

  const total = totalResult?.count || 0
  const offset = (query.page - 1) * query.limit

  // Get feedback items with category info
  const items = await db
    .select({
      feedback: feedback,
      category: feedbackCategory,
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
      },
      product: {
        id: product.id,
        name: product.name,
        slug: product.slug,
      },
      githubIssue: {
        issueNumber: githubIssueLink.issueNumber,
        issueUrl: githubIssueLink.issueUrl,
        issueState: githubIssueLink.issueState,
      },
    })
    .from(feedback)
    .leftJoin(feedbackCategory, eq(feedback.categoryId, feedbackCategory.id))
    .leftJoin(project, eq(feedback.projectId, project.id))
    .leftJoin(product, eq(feedback.productId, product.id))
    .leftJoin(githubIssueLink, eq(githubIssueLink.feedbackId, feedback.id))
    .where(whereClause)
    .orderBy(desc(feedback.isPinned), orderFn(sortColumn))
    .limit(query.limit)
    .offset(offset)

  // Check which items the viewer has voted on (authenticated user or anonymous session)
  const voterVoteMap: Map<string, 'upvote' | 'downvote'> = new Map()
  const feedbackIds = items.map((i) => i.feedback.id)
  if (feedbackIds.length > 0) {
    if (session?.user) {
      const votes = await db
        .select({ feedbackId: vote.feedbackId, type: vote.type })
        .from(vote)
        .where(eq(vote.voterUserId, session.user.id))
      votes.forEach((v) => voterVoteMap.set(v.feedbackId, v.type as 'upvote' | 'downvote'))
    } else if (anonSession) {
      const votes = await db
        .select({ feedbackId: vote.feedbackId, type: vote.type })
        .from(vote)
        .where(eq(vote.voterSessionId, anonSession.id))
      votes.forEach((v) => voterVoteMap.set(v.feedbackId, v.type as 'upvote' | 'downvote'))
    }
  }

  const result = items.map((item) => {
    const isMember = memberProjectIds.has(item.feedback.projectId)
    const isOwn = session?.user
      ? item.feedback.authorUserId === session.user.id
      : anonSession
        ? item.feedback.authorSessionId === anonSession.id
        : false
    // Non-members never receive other people's contact details, edit tokens, or
    // support-ticket content (same masking as the public board).
    const isSupportDerived = item.feedback.metadata?.source === 'support_conversation'
    // metadata.client (app version / OS) and apiKeyId are project-member-only.
    const base = isMember
      ? item.feedback
      : {
          ...stripApiKeyId(item.feedback, false),
          title: isSupportDerived ? 'Support request' : item.feedback.title,
          body: isSupportDerived ? '' : item.feedback.body,
          authorName: isSupportDerived ? null : item.feedback.authorName,
          authorEmail: isOwn ? item.feedback.authorEmail : null,
          metadata: isOwn
            ? redactClientMetadata(item.feedback.metadata, false)
            : { feedbackType: item.feedback.metadata?.feedbackType ?? null, source: item.feedback.metadata?.source },
        }
    return {
      ...base,
      productId: item.feedback.productId,
      product: item.product,
      category: item.category,
      project: item.project,
      githubIssue:
        item.githubIssue?.issueNumber && item.githubIssue.issueUrl
          ? {
              issueNumber: item.githubIssue.issueNumber,
              issueUrl: item.githubIssue.issueUrl,
              issueState: item.githubIssue.issueState,
            }
          : null,
      hasVoted: voterVoteMap.has(item.feedback.id),
      voteType: voterVoteMap.get(item.feedback.id) || null,
      isOwn,
    }
  })

  return createSuccessResponse({
    items: result,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  })
})
