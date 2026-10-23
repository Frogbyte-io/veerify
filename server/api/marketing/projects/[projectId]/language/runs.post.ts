/**
 * @openapi
 * /api/marketing/projects/{projectId}/language/runs:
 *   post:
 *     tags: [Marketing]
 *     summary: Analyze customer language for a product
 *     description: >
 *       Project admin only. Sends PII-stripped feedback and/or support text from the
 *       last 90 days (at most 300 items) to the team's own AI provider key, but
 *       only for sources the team has consented to. At most 5 runs per product per day.
 *     operationId: runCustomerLanguage
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: The stored insight }
 *       403: { description: Project admin required, or Marketing is not enabled }
 *       409: { description: No consent, fewer than 10 items, no usable key, budget reached or provider rejected }
 *       429: { description: Daily limit or provider rate limit }
 *       502: { description: Provider error }
 */
import { requireVisibilityRequest } from '~/server/services/marketing/visibility/access'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import { runCustomerLanguage } from '~/server/services/marketing/customer-language/service'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { site, project, organizationId, userId, projectId } = await requireVisibilityRequest(event)
  await requireMarketingAdmin(projectId, userId)

  const insight = await runCustomerLanguage({
    projectId,
    siteId: site.id,
    organizationId,
    userId,
    productName: project.name,
  })
  return createSuccessResponse({ insight })
})
