/**
 * @openapi
 * /api/marketing/projects/{projectId}/visibility/prompts/{promptId}:
 *   put:
 *     tags: [Marketing]
 *     summary: Update an AI visibility prompt (text and/or active flag)
 *     operationId: updateVisibilityPrompt
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
 *       200: { description: Prompt updated }
 *       400: { description: Validation failed }
 *       403: { description: Marketing is not enabled or no project access }
 *       404: { description: Prompt not found for this product }
 *       409: { description: Active-prompt cap reached }
 */
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { aiVisibilityPrompt } from '~/server/database/schema/marketing'
import {
  assertPromptCapacity,
  requireSitePrompt,
  requireVisibilityRequest,
  withPromptCapLock,
} from '~/server/services/marketing/visibility/access'
import { promptTextSchema } from '~/server/services/marketing/visibility/prompts'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'

const bodySchema = z
  .object({ text: promptTextSchema.optional(), active: z.boolean().optional() })
  .refine((value) => value.text !== undefined || value.active !== undefined, 'Nothing to update')

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
  const body = await validateBody(event, bodySchema)

  const prompt = await withPromptCapLock(site.id, async (tx) => {
    if (body.active === true && !existing.active) await assertPromptCapacity(site.id, existing.id, tx)
    const [updated] = await tx
      .update(aiVisibilityPrompt)
      .set({
        ...(body.text !== undefined ? { text: body.text } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      })
      .where(eq(aiVisibilityPrompt.id, existing.id))
      .returning()
    return updated
  })

  return createSuccessResponse({ prompt })
})
