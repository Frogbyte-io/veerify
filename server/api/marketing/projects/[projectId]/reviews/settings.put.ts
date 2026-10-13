/**
 * @openapi
 * /api/marketing/projects/{projectId}/reviews/settings:
 *   put:
 *     tags: [Marketing]
 *     summary: Save review and testimonial request settings
 *     description: >
 *       Team admins only. Replaces the whole settings object. At most 6 platforms,
 *       https URLs only, labels up to 40 characters. Shipped status values must
 *       exist in the product's feedback statuses.
 *     operationId: updateMarketingReviewSettings
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
 *             required: [enabled, platforms, askForTestimonial, csatTrigger, csatMinRating, shippedTrigger, shippedStatusValues, cooldownDays]
 *             properties:
 *               enabled: { type: boolean }
 *               platforms:
 *                 type: array
 *                 maxItems: 6
 *                 items:
 *                   type: object
 *                   required: [label, url]
 *                   properties:
 *                     id: { type: string }
 *                     label: { type: string, maxLength: 40 }
 *                     url: { type: string, format: uri }
 *               askForTestimonial: { type: boolean }
 *               csatTrigger: { type: boolean }
 *               csatMinRating: { type: integer, nullable: true }
 *               shippedTrigger: { type: boolean }
 *               shippedStatusValues: { type: array, items: { type: string } }
 *               cooldownDays: { type: integer, minimum: 1, maximum: 730 }
 *     responses:
 *       200: { description: Settings saved }
 *       400: { description: Validation failed }
 *       403: { description: Not a team admin, or Marketing is not enabled }
 *       404: { description: Product not found }
 */
import { randomUUID } from 'node:crypto'
import { db } from '~/server/database/drizzle'
import { reviewRequestSettings } from '~/server/database/schema/marketing'
import { toReviewSettings } from '~/server/services/marketing/reviews/store'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import { requireRouterParam } from '~/server/utils/marketing-mentions'
import { listProductStatuses, reviewSettingsSchema, validationError } from '~/server/utils/marketing-reviews'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { validateBody } from '~/server/utils/validation'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouterParam(event, 'projectId', 'Project ID')
  await requireMarketingAdmin(projectId, session.user.id)
  const body = await validateBody(event, reviewSettingsSchema)

  const statuses = await listProductStatuses(projectId)
  const known = new Set(statuses.map((s) => s.value))
  const unknown = body.shippedStatusValues.filter((value) => !known.has(value))
  if (unknown.length > 0) {
    validationError(`Unknown status for this product: ${unknown.join(', ')}`)
  }

  // Platform ids are stable: tracking links in already-sent emails refer to them.
  const seen = new Set<string>()
  const platforms = body.platforms.map((platform) => {
    const id = platform.id ?? randomUUID().slice(0, 8)
    if (seen.has(id)) validationError('Platform ids must be unique')
    seen.add(id)
    return { id, label: platform.label, url: platform.url }
  })

  const values = {
    enabled: body.enabled,
    platforms,
    askForTestimonial: body.askForTestimonial,
    csatTrigger: body.csatTrigger,
    csatMinRating: body.csatMinRating,
    shippedTrigger: body.shippedTrigger,
    shippedStatusValues: [...new Set(body.shippedStatusValues)],
    cooldownDays: body.cooldownDays,
  }

  const [saved] = await db
    .insert(reviewRequestSettings)
    .values({ projectId, ...values })
    .onConflictDoUpdate({ target: reviewRequestSettings.projectId, set: { ...values, updatedAt: new Date() } })
    .returning()

  return createSuccessResponse({ settings: toReviewSettings(saved!), statuses })
})
