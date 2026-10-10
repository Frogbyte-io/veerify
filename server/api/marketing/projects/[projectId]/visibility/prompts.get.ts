/**
 * @openapi
 * /api/marketing/projects/{projectId}/visibility/prompts:
 *   get:
 *     tags: [Marketing]
 *     summary: List AI visibility prompts for a product
 *     operationId: listVisibilityPrompts
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Prompts with the active-prompt cap }
 *       403: { description: Marketing is not enabled or no team access }
 *       404: { description: Project or marketing site not found }
 */
import { asc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { aiVisibilityPrompt } from '~/server/database/schema/marketing'
import { requireVisibilityRequest } from '~/server/services/marketing/visibility/access'
import { MAX_ACTIVE_PROMPTS } from '~/server/services/marketing/visibility/prompts'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { site } = await requireVisibilityRequest(event)

  const prompts = await db
    .select()
    .from(aiVisibilityPrompt)
    .where(eq(aiVisibilityPrompt.siteId, site.id))
    .orderBy(asc(aiVisibilityPrompt.createdAt), asc(aiVisibilityPrompt.id))

  return createSuccessResponse({ prompts, maxActive: MAX_ACTIVE_PROMPTS })
})
