/**
 * @openapi
 * /api/marketing/projects/{projectId}/testimonials/{id}:
 *   delete:
 *     tags: [Marketing]
 *     summary: Delete a testimonial
 *     operationId: deleteMarketingTestimonial
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Testimonial deleted }
 *       403: { description: Not a team member, or Marketing is not enabled }
 *       404: { description: Testimonial not found for this product }
 */
import { and, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { testimonial } from '~/server/database/schema/marketing'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import { requireRouterParam } from '~/server/utils/marketing-mentions'
import { notFound } from '~/server/utils/marketing-reviews'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuthWithResolvedTeam } from '~/server/utils/team-context'

export default defineEventHandler(async (event) => {
  const { session } = await requireAuthWithResolvedTeam(event)
  const projectId = requireRouterParam(event, 'projectId', 'Project ID')
  const id = requireRouterParam(event, 'id', 'Testimonial ID')
  await requireMarketingAdmin(projectId, session.user.id)

  const deleted = await db
    .delete(testimonial)
    .where(and(eq(testimonial.id, id), eq(testimonial.projectId, projectId)))
    .returning({ id: testimonial.id })
  if (deleted.length === 0) notFound('Testimonial not found')

  return createSuccessResponse({ id })
})
