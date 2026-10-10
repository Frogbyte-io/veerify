/**
 * @openapi
 * /api/marketing/projects/{projectId}/reviews/requests:
 *   post:
 *     tags: [Marketing]
 *     summary: Send review requests manually
 *     description: >
 *       Team admins only. Queues a request for up to 20 email addresses. The same
 *       guards as automatic requests apply (enabled, suppression list, cooldown).
 *       Each address gets a result; skipped addresses are not queued.
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
 *               emails: { type: array, minItems: 1, maxItems: 20, items: { type: string, format: email } }
 *     responses:
 *       200: { description: Per-address results }
 *       400: { description: Validation failed }
 *       403: { description: Not a team admin, or Marketing is not enabled }
 *       404: { description: Product not found }
 */
import { z } from 'zod'
import { enqueueReviewRequest } from '~/server/services/marketing/reviews/service'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import { requireRouterParam } from '~/server/utils/marketing-mentions'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { validateBody } from '~/server/utils/validation'

const MAX_MANUAL_REQUESTS = 20

const bodySchema = z.object({
  emails: z
    .array(z.string().trim().email('Enter valid email addresses').max(254))
    .min(1, 'Add at least one email address')
    .max(MAX_MANUAL_REQUESTS, `At most ${MAX_MANUAL_REQUESTS} addresses at a time`),
})

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouterParam(event, 'projectId', 'Project ID')
  await requireMarketingAdmin(projectId, session.user.id)
  const body = await validateBody(event, bodySchema)

  const emails = [...new Set(body.emails.map((email) => email.trim().toLowerCase()))]
  const results: Array<{ email: string; queued: boolean; reason?: string }> = []
  for (const email of emails) {
    const result = await enqueueReviewRequest({ projectId, email, trigger: 'manual', sourceId: null })
    results.push({ email, queued: result.queued, ...(result.reason ? { reason: result.reason } : {}) })
  }

  return createSuccessResponse({ results, queued: results.filter((r) => r.queued).length })
})
