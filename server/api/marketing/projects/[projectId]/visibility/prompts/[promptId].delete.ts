/**
 * @openapi
 * /api/marketing/projects/{projectId}/visibility/prompts/{promptId}:
 *   delete:
 *     tags: [Marketing]
 *     summary: Delete an AI visibility prompt and its stored answers
 *     operationId: deleteVisibilityPrompt
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: promptId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Prompt deleted }
 *       403: { description: Marketing is not enabled or no project access }
 *       404: { description: Prompt not found for this product }
 */
import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { aiVisibilityPrompt } from '~/server/database/schema/marketing'
import { requireSitePrompt, requireVisibilityRequest } from '~/server/services/marketing/visibility/access'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { site } = await requireVisibilityRequest(event)
  const promptId = getRouterParam(event, 'promptId')
  if (!promptId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Prompt ID is required'),
    })
  }

  const existing = await requireSitePrompt(site.id, promptId)
  await db.delete(aiVisibilityPrompt).where(eq(aiVisibilityPrompt.id, existing.id))

  return createSuccessResponse({ deleted: true })
})
