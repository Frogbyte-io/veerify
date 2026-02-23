import { z } from 'zod'
import { eq, and, desc, asc, count, inArray } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { getAnonSession } from '~/server/utils/anonymous-session'
import { validateQuery } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory, githubIssueLink, project, vote } from '~/server/database/schema/feedback'

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
    status: z.enum(['open', 'in_progress', 'planned', 'completed', 'closed', 'declined']).optional(),
    categoryId: z.string().optional(),
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

  const conditions = []
  if (requestedProjectIds.length === 1) {
    conditions.push(eq(feedback.projectId, requestedProjectIds[0]))
  } else {
    conditions.push(inArray(feedback.projectId, requestedProjectIds))
  }
  if (query.status) conditions.push(eq(feedback.status, query.status))
  if (query.categoryId) conditions.push(eq(feedback.categoryId, query.categoryId))

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
      githubIssue: {
        issueNumber: githubIssueLink.issueNumber,
        issueUrl: githubIssueLink.issueUrl,
        issueState: githubIssueLink.issueState,
      },
    })
    .from(feedback)
    .leftJoin(feedbackCategory, eq(feedback.categoryId, feedbackCategory.id))
    .leftJoin(project, eq(feedback.projectId, project.id))
    .leftJoin(githubIssueLink, eq(githubIssueLink.feedbackId, feedback.id))
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(query.limit)
    .offset(offset)

  // Check which items the viewer has voted on (authenticated user or anonymous session)
  let voterVotes: Set<string> = new Set()
  const feedbackIds = items.map((i) => i.feedback.id)
  if (feedbackIds.length > 0) {
    if (session?.user) {
      const votes = await db
        .select({ feedbackId: vote.feedbackId })
        .from(vote)
        .where(eq(vote.voterUserId, session.user.id))
      voterVotes = new Set(votes.map((v) => v.feedbackId))
    } else if (anonSession) {
      const votes = await db
        .select({ feedbackId: vote.feedbackId })
        .from(vote)
        .where(eq(vote.voterSessionId, anonSession.id))
      voterVotes = new Set(votes.map((v) => v.feedbackId))
    }
  }

  const result = items.map((item) => ({
    ...item.feedback,
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
    hasVoted: voterVotes.has(item.feedback.id),
    isOwn: session?.user
      ? item.feedback.authorUserId === session.user.id
      : anonSession
        ? item.feedback.authorSessionId === anonSession.id
        : false,
  }))

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
