import { z } from 'zod'
import { eq, and, desc, asc, count } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { optionalAuth } from '~/server/utils/auth-middleware'
import { getAnonSession } from '~/server/utils/anonymous-session'
import { validateQuery } from '~/server/utils/validation'
import { resolvePublicProjectByTeam } from '~/server/utils/project-access'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory, vote } from '~/server/database/schema/feedback'

const querySchema = z.object({
  status: z.enum(['open', 'in_progress', 'planned', 'completed', 'closed', 'declined']).optional(),
  categoryId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(['createdAt', 'voteCount']).default('voteCount'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

export default defineEventHandler(async (event) => {
  const teamSlug = getRouterParam(event, 'teamSlug')
  const projectSlug = getRouterParam(event, 'projectSlug')

  const session = await optionalAuth(event)
  const anonSession = !session?.user ? await getAnonSession(event) : null
  const query = validateQuery(event, querySchema)

  const { project: proj } = await resolvePublicProjectByTeam(teamSlug!, projectSlug!)

  const conditions = [eq(feedback.projectId, proj.id), eq(feedback.isHidden, false)]
  if (query.status) conditions.push(eq(feedback.status, query.status))
  if (query.categoryId) conditions.push(eq(feedback.categoryId, query.categoryId))

  const whereClause = and(...conditions)

  const sortColumn = query.sortBy === 'createdAt' ? feedback.createdAt : feedback.voteCount
  const orderFn = query.sortOrder === 'asc' ? asc : desc

  const [totalResult] = await db.select({ count: count() }).from(feedback).where(whereClause)
  const total = totalResult?.count || 0
  const offset = (query.page - 1) * query.limit

  const items = await db
    .select({ feedback: feedback, category: feedbackCategory })
    .from(feedback)
    .leftJoin(feedbackCategory, eq(feedback.categoryId, feedbackCategory.id))
    .where(whereClause)
    .orderBy(desc(feedback.isPinned), orderFn(sortColumn))
    .limit(query.limit)
    .offset(offset)

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
    id: item.feedback.id,
    title: item.feedback.title,
    body: item.feedback.body,
    status: item.feedback.status,
    voteCount: item.feedback.voteCount,
    commentCount: item.feedback.commentCount,
    authorName: item.feedback.authorName,
    isPinned: item.feedback.isPinned,
    createdAt: item.feedback.createdAt,
    hasVoted: voterVotes.has(item.feedback.id),
    isOwn: session?.user
      ? item.feedback.authorUserId === session.user.id
      : anonSession
        ? item.feedback.authorSessionId === anonSession.id
        : false,
    category: item.category
      ? {
          id: item.category.id,
          name: item.category.name,
          slug: item.category.slug,
          icon: item.category.icon,
          color: item.category.color,
        }
      : null,
  }))

  return createSuccessResponse({
    items: result,
    pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
  })
})
