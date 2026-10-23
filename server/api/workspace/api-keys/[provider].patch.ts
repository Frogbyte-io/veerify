/**
 * @openapi
 * /api/workspace/api-keys/{provider}:
 *   patch:
 *     tags: [Marketing]
 *     summary: Set or clear the monthly budget of an LLM key
 *     description: Workspace owners and admins only. Applies to LLM provider keys (anthropic, openai, perplexity, gemini). Null removes the cap.
 *     operationId: patchMarketingCredential
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string, enum: [anthropic, openai, perplexity, gemini] }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [monthlyBudgetCents]
 *             properties:
 *               monthlyBudgetCents: { type: integer, nullable: true }
 *     responses:
 *       200: { description: Budget updated }
 *       400: { description: Not an LLM provider or invalid budget }
 *       403: { description: Workspace owner or admin required }
 *       404: { description: No key stored for this provider }
 */
import { z } from 'zod'
import { requireAuthWithOrganization } from '~/server/utils/project-context'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { updateCredentialBudget } from '~/server/utils/org-credentials'
import {
  badRequest,
  isLlmCredentialProvider,
  requireCredentialProvider,
  requireCredentialAdmin,
} from '~/server/utils/marketing-credential-routes'

const bodySchema = z.object({
  monthlyBudgetCents: z.number().int().min(0).max(100_000_000).nullable(),
})

export default defineEventHandler(async (event) => {
  const { session, organizationId } = await requireAuthWithOrganization(event)
  const provider = requireCredentialProvider(event)
  await requireCredentialAdmin(organizationId, session.user.id)
  const body = await validateBody(event, bodySchema)

  if (!isLlmCredentialProvider(provider)) {
    badRequest('A monthly budget only applies to LLM provider keys')
  }

  const updated = await updateCredentialBudget(organizationId, provider, body.monthlyBudgetCents)
  if (!updated) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'No key stored for this provider'),
    })
  }

  return createSuccessResponse({ provider, monthlyBudgetCents: body.monthlyBudgetCents })
})
