/**
 * @openapi
 * /api/marketing/projects/{projectId}/reviews/requests:
 *   post:
 *     tags: [Marketing]
 *     summary: Send review requests manually
 *     description: >
 *       Project admins only. Queues a request for up to 20 email addresses. The same
 *       guards as automatic requests apply (enabled, suppression list, cooldown).
 *       Each address gets its own result (invalid addresses and skipped addresses
 *       are reported per address, not queued). Limited to 10 calls per hour per
 *       product and 100 manually queued requests per team per day
 *       (reason `daily_limit`).
 *     operationId: createMarketingReviewRequests
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
 *             required: [emails]
 *             properties:
 *               emails: { type: array, minItems: 1, maxItems: 20, items: { type: string, maxLength: 254 } }
 *     responses:
 *       200: { description: Per-address results }
 *       400: { description: Validation failed }
 *       403: { description: Not a team admin, or Marketing is not enabled }
 *       404: { description: Product not found }
 *       429: { description: Rate limited }
 */
import { z } from 'zod'
import { enqueueManualReviewRequests } from '~/server/services/marketing/reviews/service'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import { requireRouterParam } from '~/server/utils/marketing-mentions'
import { rateLimits, requireRateLimit } from '~/server/utils/rate-limit'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { validateBody } from '~/server/utils/validation'

const MAX_MANUAL_REQUESTS = 20

const MANUAL_CALLS_PER_HOUR = 10

// Addresses are validated one by one by the service, so a typo is reported against that address
// instead of failing the whole batch.
const bodySchema = z.object({
  emails: z
    .array(z.string().trim().max(254, 'Email addresses must be 254 characters or fewer'))
    .min(1, 'Add at least one email address')
    .max(MAX_MANUAL_REQUESTS, `At most ${MAX_MANUAL_REQUESTS} addresses at a time`),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouterParam(event, 'projectId', 'Project ID')
  await requireMarketingAdmin(projectId, session.user.id)
  // Per product (the subject replaces the client IP), so several admins share one budget.
  await requireRateLimit(event, {
    maxRequests: MANUAL_CALLS_PER_HOUR,
    windowSeconds: 3600,
    identifier: 'marketing-review-manual',
    subject: projectId,
  })
  const body = await validateBody(event, bodySchema)

  const results = await enqueueManualReviewRequests({ projectId, emails: body.emails })

  return createSuccessResponse({ results, queued: results.filter((r) => r.queued).length })
})
