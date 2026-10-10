/**
 * @openapi
 * /api/marketing/projects/{projectId}/visibility/prompts:
 *   post:
 *     tags: [Marketing]
 *     summary: Create an AI visibility prompt
 *     description: Text must be 10-300 characters; at most 25 prompts can be active per product.
 *     operationId: createVisibilityPrompt
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Prompt created }
 *       400: { description: Validation failed }
 *       403: { description: Marketing is not enabled or no team access }
 *       409: { description: Duplicate prompt or active-prompt cap reached }
 */
import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { aiVisibilityPrompt } from '~/server/database/schema/marketing'
import { assertPromptCapacity, requireVisibilityRequest } from '~/server/services/marketing/visibility/access'
import { promptTextSchema } from '~/server/services/marketing/visibility/prompts'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'

const bodySchema = z.object({
  text: promptTextSchema,
  active: z.boolean().optional(),
  source: z.enum(['user', 'suggested']).optional(),
})

export default defineEventHandler(async (event) => {
  const { site } = await requireVisibilityRequest(event)
  const body = await validateBody(event, bodySchema)
  const active = body.active ?? true

  const [duplicate] = await db
    .select({ id: aiVisibilityPrompt.id })
    .from(aiVisibilityPrompt)
    .where(
      and(eq(aiVisibilityPrompt.siteId, site.id), sql`lower(${aiVisibilityPrompt.text}) = ${body.text.toLowerCase()}`)
    )
    .limit(1)
  if (duplicate) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(ErrorCode.CONFLICT, 'This prompt already exists'),
    })
  }

  if (active) await assertPromptCapacity(site.id)

  const [prompt] = await db
    .insert(aiVisibilityPrompt)
    .values({ id: randomUUID(), siteId: site.id, text: body.text, active, source: body.source ?? 'user' })
    .returning()

  return createSuccessResponse({ prompt })
})
