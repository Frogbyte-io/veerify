/**
 * @openapi
 * /api/marketing/projects/{projectId}/data:
 *   delete:
 *     tags: [Marketing]
 *     summary: Delete a product's Marketing data
 *     description: >
 *       Team admins only; works while Marketing is switched off. Requires the product slug as
 *       confirmation. Revokes a connected Google Search Console token (best effort), then deletes the
 *       marketing site with its audits, visibility, mentions, competitors, insights and Search Console
 *       data, plus the product's review requests, testimonials, launch kit and announcement drafts.
 *       Team-level API keys, consent and email suppressions are kept.
 *     operationId: deleteMarketingData
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
 *             required: [confirm]
 *             properties:
 *               confirm: { type: string, description: The product slug }
 *     responses:
 *       200: { description: Counts of what was deleted }
 *       400: { description: Confirmation missing or does not match the product slug }
 *       403: { description: Team admin required }
 *       404: { description: Product not found }
 */
import { z } from 'zod'
import { deleteProductMarketingData } from '~/server/services/marketing/privacy'
import { requireMarketingDataAdmin } from '~/server/utils/marketing-access'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'
import { validateBody } from '~/server/utils/validation'

const bodySchema = z.object({ confirm: z.string() })

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouteParam(event, 'projectId')
  const { project } = await requireMarketingDataAdmin(projectId, session.user.id)
  const body = await validateBody(event, bodySchema)

  if (body.confirm !== project.slug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Type the product slug to confirm the deletion'),
    })
  }

  return createSuccessResponse(await deleteProductMarketingData(projectId))
})
