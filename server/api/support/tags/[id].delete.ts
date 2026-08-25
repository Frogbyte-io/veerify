/**
 * @openapi
 * /api/support/tags/{id}:
 *   delete:
 *     tags: [Support]
 *     summary: Delete a tag
 *     description: >
 *       Hard delete. `conversationTag` rows referencing this tag cascade with
 *       it, so deleting a tag unassigns it from every conversation it was on.
 *     operationId: deleteSupportTag
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Tag deleted }
 *       403: { description: Not a member of the tag's team }
 *       404: { description: Tag not found }
 */
import { eq } from 'drizzle-orm'
import { createError } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireSupportTeamRole } from '~/server/utils/support-access'
import { db } from '~/server/database/drizzle'
import { supportTag } from '~/server/database/schema/support'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const tagId = getRouterParam(event, 'id') as string

  const [tag] = await db.select().from(supportTag).where(eq(supportTag.id, tagId)).limit(1)

  if (!tag) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Tag not found'),
    })
  }

  // Resolve-then-check (rather than a helper like `requireCompanyAccess`, since
  // there is no `requireTagAccess`) so a caller cannot delete another team's tag.
  await requireSupportTeamRole(tag.teamId, session.user.id, 'supervisor')

  // Cascades to `conversationTag` - see @openapi description above.
  await db.delete(supportTag).where(eq(supportTag.id, tagId))

  return createSuccessResponse({ deleted: true })
})
