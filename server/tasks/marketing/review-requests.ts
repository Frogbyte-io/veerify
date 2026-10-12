import { marketingReviewRequestsTask } from '~/server/services/scheduler/tasks/marketing-review-requests'

export default defineTask({
  meta: {
    name: 'marketing:review-requests',
    description: 'Send queued review and testimonial request emails.',
  },
  async run() {
    const result = await marketingReviewRequestsTask.handler()
    return { result }
  },
})
