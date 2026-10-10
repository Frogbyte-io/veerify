/**
 * @openapi
 * /api/marketing/teams/{teamId}/credentials/{provider}:
 *   patch:
 *     tags: [Marketing]
 *     summary: Set or clear the monthly budget of an LLM key
 *     description: Team admins only. Applies to anthropic and openai keys. Null removes the cap.
 *     operationId: patchMarketingCredential
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: provider
 *         required: true
 *         schema: { type: string, enum: [anthropic, openai] }
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
 *       403: { description: Team admin required }
 *       404: { description: No key stored for this provider }
 */
import { z } from 'zod'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { requireTeamAdmin } from '~/server/utils/support-access'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { updateCredentialBudget } from '~/server/utils/team-credentials'
import { requireRouteParam } from '~/server/utils/marketing-site'
import {
  badRequest,
  isLlmCredentialProvider,
  requireCredentialProvider,
} from '~/server/utils/marketing-credential-routes'

const bodySchema = z.object({
  monthlyBudgetCents: z.number().int().min(0).max(100_000_000).nullable(),
})

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const teamId = requireRouteParam(event, 'teamId')
  const provider = requireCredentialProvider(event)
  await requireTeamAdmin(teamId, session.user.id)
  const body = await validateBody(event, bodySchema)

  if (!isLlmCredentialProvider(provider)) {
    badRequest('A monthly budget only applies to Anthropic and OpenAI keys')
  }

  const updated = await updateCredentialBudget(teamId, provider, body.monthlyBudgetCents)
  if (!updated) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'No key stored for this provider'),
    })
  }

  return createSuccessResponse({ provider, monthlyBudgetCents: body.monthlyBudgetCents })
})
