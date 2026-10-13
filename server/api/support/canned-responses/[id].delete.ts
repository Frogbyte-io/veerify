/**
 * @openapi
 * /api/support/canned-responses/{id}:
 *   delete:
 *     tags: [Support]
 *     summary: Delete a team canned response
 *     operationId: deleteSupportCannedResponse
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Canned response deleted }
 *       403: { description: Not a member of the team }
 *       404: { description: Canned response not found }
 */
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireTeamMembership } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { cannedResponse } from '~/server/database/schema/support'

function notFound(): never {
  throw createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    data: createErrorResponse(ErrorCode.NOT_FOUND, 'Canned response not found'),
  })
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const responseId = getRouterParam(event, 'id') as string

  const [existing] = await db.select().from(cannedResponse).where(eq(cannedResponse.id, responseId)).limit(1)
  if (!existing) notFound()

  await requireTeamMembership(existing.teamId, session.user.id)

  await db.delete(cannedResponse).where(eq(cannedResponse.id, responseId))

  return createSuccessResponse({ deleted: true })
})
