import { processReviewRequests } from '~/server/services/marketing/reviews/service'
import { defineScheduledTask } from '../registry'

/** Sends queued review and testimonial request emails. */
export const MARKETING_REVIEW_REQUESTS_TASK_NAME = 'marketing:review-requests'

export const marketingReviewRequestsTask = defineScheduledTask(MARKETING_REVIEW_REQUESTS_TASK_NAME, '*/5 * * * *', () =>
  processReviewRequests({ budgetMs: 45_000 })
)
