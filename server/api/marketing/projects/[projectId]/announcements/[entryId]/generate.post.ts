/**
 * @openapi
 * /api/marketing/projects/{projectId}/announcements/{entryId}/generate:
 *   post:
 *     tags: [Marketing]
 *     summary: Generate announcement drafts for a published changelog entry
 *     description: >
 *       Uses the workspace's own LLM key (Anthropic first, then OpenAI, Gemini, Perplexity). Regenerating overwrites
 *       existing drafts, hand edits included. Nothing is ever posted.
 *     operationId: generateMarketingAnnouncements
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               channels:
 *                 type: array
 *                 items: { type: string, enum: [x, linkedin, bluesky, newsletter] }
 *     responses:
 *       200: { description: The generated drafts }
 *       400: { description: Validation failed }
 *       403: { description: Marketing is not enabled or no project access }
 *       404: { description: Entry not found for this product }
 *       409: { description: Entry unpublished, no usable LLM key, budget reached, quota or key rejected }
 *       429: { description: Rate limit (20 per hour and 50 per day per product) or provider rate limit }
 *       502: { description: Provider error or unusable model output }
 */
import { z } from 'zod'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { dayStamp, requireDbLimit } from '~/server/utils/marketing-db-limit'
import { requireRateLimit } from '~/server/utils/rate-limit'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { ANNOUNCEMENT_CHANNELS } from '~/server/services/marketing/announcements/prompt'
import { generateAnnouncementDrafts } from '~/server/services/marketing/announcements/service'

const bodySchema = z.object({
  channels: z.array(z.enum(ANNOUNCEMENT_CHANNELS)).min(1).max(ANNOUNCEMENT_CHANNELS.length).optional(),
})

const GENERATIONS_PER_DAY = 50

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  const entryId = requireRouteParam(event, 'entryId')
  const { organizationId } = await requireMarketingAccess(projectId, session.user.id)
  const body = await validateBody(event, bodySchema)

  // Each call spends the workspace's own provider credit: 20 per hour per product
  await requireRateLimit(event, {
    maxRequests: 20,
    windowSeconds: 3600,
    identifier: 'announcement-generate',
    subject: projectId,
  })

  // Counted in the database so the cap holds across serverless instances
  await requireDbLimit(
    organizationId,
    `ratelimit:announce:${projectId}:${dayStamp()}`,
    GENERATIONS_PER_DAY,
    'Daily limit of announcement generations reached for this product. Try again tomorrow'
  )

  const drafts = await generateAnnouncementDrafts(entryId, {
    userId: session.user.id,
    projectId,
    channels: body.channels,
    requestUrl: getRequestURL(event),
  })
  return createSuccessResponse({ drafts })
})
