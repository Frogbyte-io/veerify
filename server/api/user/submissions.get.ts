/**
 * @openapi
 * /api/user/submissions:
 *   get:
 *     tags: [User]
 *     summary: My submissions
 *     description: >
 *       Lists feedback the caller authored across all projects, newest first, with page-based pagination. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: listMySubmissions
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         required: false
 *         description: "1-based page number"
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         required: false
 *         description: "Page size"
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *     responses:
 *       200: { description: "{ success, data: submissions (with projectName and projectSlug), pagination: { page, limit, totalCount, totalPages } }" }
 *       401: { description: "Not authenticated" }
 */
import { db } from '~/server/database/drizzle'
import { feedback, project } from '~/server/database/schema/feedback'
import { eq, desc, sql } from 'drizzle-orm'
import { requireAuth } from '~/server/utils/auth-middleware'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)

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
