import { auth } from '~/lib/auth'
import { db } from '~/server/database/drizzle'
import { feedback, project } from '~/server/database/schema/feedback'
import { eq, desc, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({
    headers: event.node.req.headers as any,
  })
  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const query = getQuery(event)
  const page = Math.max(1, parseInt(String(query.page || '1'), 10))
  const limit = Math.min(50, Math.max(1, parseInt(String(query.limit || '20'), 10)))
  const offset = (page - 1) * limit

  // Get all feedback submitted by this user across all projects
  const [items, countResult] = await Promise.all([
    db
      .select({
        id: feedback.id,
        title: feedback.title,
        body: feedback.body,
        status: feedback.status,
        voteCount: feedback.voteCount,
        commentCount: feedback.commentCount,
        createdAt: feedback.createdAt,
        updatedAt: feedback.updatedAt,
        projectId: feedback.projectId,
        projectName: project.name,
        projectSlug: project.slug,
      })
      .from(feedback)
      .leftJoin(project, eq(feedback.projectId, project.id))
      .where(eq(feedback.authorUserId, session.user.id))
      .orderBy(desc(feedback.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(feedback)
      .where(eq(feedback.authorUserId, session.user.id)),
  ])

  const totalCount = countResult[0]?.count || 0

  return {
    success: true,
    data: items,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
  }
})
