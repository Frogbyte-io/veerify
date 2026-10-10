/**
 * @openapi
 * /api/cron/marketing-review-requests:
 *   get:
 *     tags: [Internal]
 *     summary: Send queued review and testimonial request emails
 *     operationId: cronMarketingReviewRequests
 *     responses:
 *       200: { description: Review requests processed }
 *       401: { description: Missing or invalid cron secret }
 */
import { createCronHttpHandler } from '~/server/services/scheduler'
import { MARKETING_REVIEW_REQUESTS_TASK_NAME } from '~/server/services/scheduler/tasks/marketing-review-requests'

export default createCronHttpHandler(MARKETING_REVIEW_REQUESTS_TASK_NAME)
