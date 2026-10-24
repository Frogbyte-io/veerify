/**
 * @openapi
 * /api/support/canned-responses:
 *   get:
 *     tags: [Support]
 *     summary: List project canned responses
 *     operationId: listSupportCannedResponses
 *     parameters:
 *       - in: query
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Canned response list }
 *       403: { description: Not a member of the project }
 */
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireProjectAccess } from '~/server/utils/project-access'
import { validateQuery } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { cannedResponse } from '~/server/database/schema/support'

const querySchema = z.object({
  projectId: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const query = validateQuery(event, querySchema)

  await requireProjectAccess(query.projectId, session.user.id)

  const cannedResponses = await db
    .select()
    .from(cannedResponse)
    .where(eq(cannedResponse.projectId, query.projectId))
    .orderBy(asc(cannedResponse.shortcode))

  return createSuccessResponse({ cannedResponses })
})
