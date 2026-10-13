/**
 * @openapi
 * /api/marketing/projects/{projectId}/language/apply:
 *   post:
 *     tags: [Marketing]
 *     summary: Add suggested terms and prompts from a language insight
 *     description: >
 *       Uses the same validation and caps as the terms and prompts endpoints (50 terms;
 *       25 active and 100 total prompts). Duplicates and items over a cap are skipped
 *       and reported.
 *     operationId: applyCustomerLanguageSuggestions
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               terms:
 *                 type: array
 *                 maxItems: 15
 *                 items:
 *                   type: object
 *                   required: [kind, label]
 *                   properties:
 *                     kind: { type: string, enum: [keyword, competitor] }
 *                     label: { type: string }
 *               prompts:
 *                 type: array
 *                 maxItems: 10
 *                 items: { type: string }
 *     responses:
 *       200: { description: What was added and what was skipped, with reasons }
 *       400: { description: Validation failed }
 *       403: { description: Marketing is not enabled or no team access }
 *       404: { description: No marketing site is set up }
 */
import { z } from 'zod'
import { requireVisibilityRequest } from '~/server/services/marketing/visibility/access'
import { applyLanguageSuggestions } from '~/server/services/marketing/customer-language/apply'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'

const bodySchema = z.object({
  terms: z
    .array(z.object({ kind: z.enum(['keyword', 'competitor']), label: z.string() }))
    .max(15)
    .optional(),
  prompts: z.array(z.string()).max(10).optional(),
})

export default defineEventHandler(async (event) => {
  const { site } = await requireVisibilityRequest(event)
  const body = await validateBody(event, bodySchema)
  return createSuccessResponse(await applyLanguageSuggestions(site.id, body))
})
