/**
 * @openapi
 * /api/projects/{slug}/api-keys/{keyId}:
 *   delete:
 *     tags: [Projects]
 *     summary: Revoke an app key
 *     description: "Revoked keys are rejected immediately and the row is kept for audit."
 *     operationId: revokeProjectApiKey
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: keyId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "Key revoked" }
 *       403: { description: "Not a team member" }
 *       404: { description: "Project or key not found, or key already revoked" }
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { projectApiKey } from '~/server/database/schema/feedback'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectCategoryAccess(event)
  const keyId = getRouterParam(event, 'keyId')

  if (!keyId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Key ID is required'),
    })
  }

  const [revoked] = await db
    .update(projectApiKey)
    .set({ revokedAt: new Date() })
    .where(and(eq(projectApiKey.id, keyId), eq(projectApiKey.projectId, project.id), isNull(projectApiKey.revokedAt)))
    .returning({ id: projectApiKey.id, revokedAt: projectApiKey.revokedAt })

  if (!revoked) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'App key not found'),
    })
  }

  return createSuccessResponse(revoked)
})
