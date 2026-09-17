/**
 * @openapi
 * /api/support/conversations/{id}/feedback:
 *   get:
 *     tags: [Support]
 *     summary: Search feedback for a conversation link
 *     operationId: searchSupportConversationFeedback
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string, maxLength: 200 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *     responses:
 *       200: { description: Matching team feedback items }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Conversation not found }
 */
import { z } from 'zod'
import { and, desc, eq, ilike, or } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { validateQuery } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory, project } from '~/server/database/schema/feedback'

const querySchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const conversationId = getRouterParam(event, 'id') as string
  const query = validateQuery(event, querySchema)
  const accessibleConversation = await requireConversationAccess(conversationId, session.user.id)

  const conditions = [eq(project.teamId, accessibleConversation.teamId)]
  if (query.search) {
    const pattern = `%${query.search}%`
    conditions.push(or(ilike(feedback.title, pattern), ilike(feedback.body, pattern))!)
  }

  const items = await db
    .select({
      id: feedback.id,
      title: feedback.title,
      body: feedback.body,
      status: feedback.status,
      voteCount: feedback.voteCount,
      project: { id: project.id, name: project.name, slug: project.slug },
      category: { id: feedbackCategory.id, name: feedbackCategory.name },
    })
    .from(feedback)
    .innerJoin(project, eq(project.id, feedback.projectId))
    .leftJoin(feedbackCategory, eq(feedbackCategory.id, feedback.categoryId))
    .where(and(...conditions))
    .orderBy(desc(feedback.updatedAt), desc(feedback.id))
    .limit(query.limit)

  return createSuccessResponse({ items })
})
