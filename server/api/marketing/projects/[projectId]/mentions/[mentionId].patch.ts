/**
 * @openapi
 * /api/marketing/projects/{projectId}/mentions/{mentionId}:
 *   patch:
 *     tags: [Marketing]
 *     summary: Change the triage status of a mention
 *     operationId: updateMarketingMention
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: mentionId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [new, seen, dismissed] }
 *     responses:
 *       200: { description: Mention updated }
 *       403: { description: No access to this project, or Marketing is not enabled }
 *       404: { description: Mention not found for this product }
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { mention } from '~/server/database/schema/marketing'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { requireMentionsSite, requireRouterParam } from '~/server/utils/marketing-mentions'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { validateBody } from '~/server/utils/validation'

const bodySchema = z.object({ status: z.enum(['new', 'seen', 'dismissed']) })

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouterParam(event, 'projectId', 'Project ID')
  const mentionId = requireRouterParam(event, 'mentionId', 'Mention ID')
  await requireMarketingAccess(projectId, session.user.id)
  const body = await validateBody(event, bodySchema)

  const site = await requireMentionsSite(projectId)

  // Scoping the UPDATE by siteId is what stops a member of one product from
  // changing another product's mention by guessing its id.
  const [updated] = await db
    .update(mention)
    .set({ status: body.status })
    .where(and(eq(mention.id, mentionId), eq(mention.siteId, site.id)))
    .returning({ id: mention.id, status: mention.status })

  if (!updated) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Mention not found'),
    })
  }

  return createSuccessResponse(updated)
})
