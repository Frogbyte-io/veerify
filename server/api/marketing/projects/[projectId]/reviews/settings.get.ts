/**
 * @openapi
 * /api/marketing/projects/{projectId}/reviews/settings:
 *   get:
 *     tags: [Marketing]
 *     summary: Get review and testimonial request settings
 *     description: >
 *       Returns the product's settings (defaults when never saved: disabled) and
 *       the product's feedback statuses, for the "shipped" trigger picker.
 *     operationId: getMarketingReviewSettings
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Settings and available statuses }
 *       403: { description: Not a team member, or Marketing is not enabled }
 *       404: { description: Product not found }
 */
import { dbReviewsStore } from '~/server/services/marketing/reviews/store'
import { DEFAULT_REVIEW_SETTINGS } from '~/server/services/marketing/reviews/types'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { requireRouterParam } from '~/server/utils/marketing-mentions'
import { listProductStatuses } from '~/server/utils/marketing-reviews'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouterParam(event, 'projectId', 'Project ID')
  await requireMarketingAccess(projectId, session.user.id)

  const [ctx, statuses] = await Promise.all([
    dbReviewsStore.loadProjectContext(projectId),
    listProductStatuses(projectId),
  ])

  return createSuccessResponse({
    settings: ctx?.settings ?? DEFAULT_REVIEW_SETTINGS,
    statuses,
  })
})
