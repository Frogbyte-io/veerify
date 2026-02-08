import { z } from 'zod'
import { eq, and, desc, asc, count, sql } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { validateQuery } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory, vote } from '~/server/database/schema/feedback'
import { user } from '~/server/database/schema/auth'

const listFeedbackQuerySchema = z.object({
  projectId: z.string().optional(),
  status: z.enum(['open', 'in_progress', 'planned', 'completed', 'closed', 'declined']).optional(),
  categoryId: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(['createdAt', 'updatedAt', 'voteCount', 'title']).default('voteCount'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

export default defineEventHandler(async (event) => {
  const session = await optionalAuth(event)
  const query = validateQuery(event, listFeedbackQuerySchema)

  // Build conditions
  const conditions = []
  if (query.projectId) conditions.push(eq(feedback.projectId, query.projectId))
  if (query.status) conditions.push(eq(feedback.status, query.status))
  if (query.categoryId) conditions.push(eq(feedback.categoryId, query.categoryId))

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  // Sort
  const sortColumn = {
    createdAt: feedback.createdAt,
    updatedAt: feedback.updatedAt,
    voteCount: feedback.voteCount,
    title: feedback.title,
  }[query.sortBy]
  const orderFn = query.sortOrder === 'asc' ? asc : desc

  // Get total count
  const [totalResult] = await db
    .select({ count: count() })
    .from(feedback)
    .where(whereClause)

  const total = totalResult?.count || 0
  const offset = (query.page - 1) * query.limit

  // Get feedback items with category info
  const items = await db
    .select({
      feedback: feedback,
      category: feedbackCategory,
    })
    .from(feedback)
    .leftJoin(feedbackCategory, eq(feedback.categoryId, feedbackCategory.id))
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(query.limit)
    .offset(offset)

  // If authenticated, check which items the user has voted on
  let userVotes: Set<string> = new Set()
  if (session?.user) {
    const feedbackIds = items.map((i) => i.feedback.id)
    if (feedbackIds.length > 0) {
      const votes = await db
        .select({ feedbackId: vote.feedbackId })
        .from(vote)
        .where(and(eq(vote.voterUserId, session.user.id)))
      userVotes = new Set(votes.map((v) => v.feedbackId))
    }
  }

  const result = items.map((item) => ({
    ...item.feedback,
    category: item.category,
    hasVoted: session?.user ? userVotes.has(item.feedback.id) : undefined,
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
