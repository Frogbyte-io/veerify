/**
 * @openapi
 * /api/marketing/projects/{projectId}/visibility/prompts/suggest:
 *   post:
 *     tags: [Marketing]
 *     summary: Suggest AI visibility prompts (not saved)
 *     description: >
 *       Uses the team's own LLM key (Anthropic first, then OpenAI, Gemini, Perplexity). Only the product
 *       name, description and feedback category names are sent to the provider.
 *     operationId: suggestVisibilityPrompts
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Up to 8 suggested prompts }
 *       403: { description: Marketing is not enabled or no team access }
 *       409: { description: No usable LLM key or monthly budget reached or provider out of credit }
 *       429: { description: Rate limit (10 per hour and 40 per day per site) or provider rate limit }
 *       502: { description: Provider error }
 */
import { requireVisibilityRequest } from '~/server/services/marketing/visibility/access'
import { suggestPrompts } from '~/server/services/marketing/visibility/suggest'
import { dayStamp, requireDbLimit } from '~/server/utils/marketing-db-limit'
import { requireRateLimit } from '~/server/utils/rate-limit'
import { createSuccessResponse } from '~/server/utils/response'

const SUGGESTIONS_PER_DAY = 40

export default defineEventHandler(async (event) => {
  const { site, project, teamId } = await requireVisibilityRequest(event)

  // Each call spends the team's own provider credit: 10 per hour per site
  await requireRateLimit(event, {
    maxRequests: 10,
    windowSeconds: 3600,
    identifier: 'visibility-suggest',
    subject: site.id,
  })

  // Same cap, but counted in the database so it holds across serverless instances
  await requireDbLimit(
    teamId,
    `ratelimit:suggest:${site.id}:${dayStamp()}`,
    SUGGESTIONS_PER_DAY,
    'Daily limit of prompt suggestions reached for this site. Try again tomorrow'
  )

  const result = await suggestPrompts({
    teamId,
    siteId: site.id,
    project: { id: project.id, name: project.name, description: project.description },
  })

  return createSuccessResponse(result)
})
