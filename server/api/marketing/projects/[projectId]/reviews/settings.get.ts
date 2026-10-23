/**
 * @openapi
 * /api/marketing/projects/{projectId}/reviews/settings:
 *   get:
 *     tags: [Marketing]
 *     summary: Get review and testimonial request settings
 *     description: >
 *       Returns the product's settings (defaults when never saved: disabled) and
 *       the product's feedback statuses, for the "shipped" trigger picker, and
 *       `canManage` (true for project admins) so the UI can show a read-only view.
 *     operationId: getMarketingReviewSettings
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Settings and available statuses }
 *       403: { description: No access to this project, or Marketing is not enabled }
 *       404: { description: Product not found }
 */
import { dbReviewsStore } from '~/server/services/marketing/reviews/store'
import { DEFAULT_REVIEW_SETTINGS } from '~/server/services/marketing/reviews/types'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { requireRouterParam } from '~/server/utils/marketing-mentions'
import { listProductStatuses } from '~/server/utils/marketing-reviews'
import { isMarketingAdminOf } from '~/server/utils/marketing-site'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouterParam(event, 'projectId', 'Project ID')
  const { organizationId } = await requireMarketingAccess(projectId, session.user.id)

  const [ctx, statuses, canManage] = await Promise.all([
    dbReviewsStore.loadProjectContext(projectId),
    listProductStatuses(projectId),
    isMarketingAdminOf(projectId, session.user.id),
  ])

  return createSuccessResponse({
    settings: ctx?.settings ?? DEFAULT_REVIEW_SETTINGS,
    statuses,
    canManage,
  })
})
