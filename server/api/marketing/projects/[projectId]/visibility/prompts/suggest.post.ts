/**
 * @openapi
 * /api/marketing/projects/{projectId}/visibility/prompts/suggest:
 *   post:
 *     tags: [Marketing]
 *     summary: Suggest AI visibility prompts (not saved)
 *     description: >
 *       Uses the team's own LLM key (Anthropic first, else OpenAI). Only the product
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
 *       409: { description: No usable LLM key }
 *       429: { description: Provider rate limit }
 *       502: { description: Provider error }
 */
import { requireVisibilityRequest } from '~/server/services/marketing/visibility/access'
import { suggestPrompts } from '~/server/services/marketing/visibility/suggest'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { site, project, teamId } = await requireVisibilityRequest(event)

  const result = await suggestPrompts({
    teamId,
    siteId: site.id,
    project: { id: project.id, name: project.name, description: project.description },
  })

  return createSuccessResponse(result)
})
