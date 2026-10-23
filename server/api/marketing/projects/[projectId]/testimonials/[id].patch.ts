/**
 * @openapi
 * /api/marketing/projects/{projectId}/testimonials/{id}:
 *   patch:
 *     tags: [Marketing]
 *     summary: Moderate a testimonial
 *     description: >
 *       Change the status and/or the featured flag. Only testimonials the author
 *       consented to publish can be featured. A testimonial without public consent
 *       can be approved for private use but never appears on the public wall.
 *     operationId: updateMarketingTestimonial
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [pending, approved, rejected] }
 *               featured: { type: boolean }
 *     responses:
 *       200: { description: Testimonial updated }
 *       400: { description: Validation failed }
 *       403: { description: Not a team member, or Marketing is not enabled }
 *       404: { description: Testimonial not found for this product }
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { testimonial } from '~/server/database/schema/marketing'
import { requireMarketingAdmin } from '~/server/utils/marketing-access'
import { requireRouterParam } from '~/server/utils/marketing-mentions'
import { notFound, validationError } from '~/server/utils/marketing-reviews'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { validateBody } from '~/server/utils/validation'

const bodySchema = z
  .object({
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
    featured: z.boolean().optional(),
  })
  .refine((value) => value.status !== undefined || value.featured !== undefined, {
    message: 'Provide a status or featured flag',
  })

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouterParam(event, 'projectId', 'Project ID')
  const id = requireRouterParam(event, 'id', 'Testimonial ID')
  await requireMarketingAdmin(projectId, session.user.id)
  const body = await validateBody(event, bodySchema)

  // Scoped by projectId so a member of one product cannot touch another's testimonials.
  const [existing] = await db
    .select({ id: testimonial.id, consentPublic: testimonial.consentPublic, status: testimonial.status })
    .from(testimonial)
    .where(and(eq(testimonial.id, id), eq(testimonial.projectId, projectId)))
    .limit(1)
  if (!existing) notFound('Testimonial not found')

  const nextStatus = body.status ?? existing.status
  if (body.featured === true && !existing.consentPublic) {
    validationError('Only testimonials the author consented to publish can be featured')
  }
  if (body.featured === true && nextStatus !== 'approved') {
    validationError('Only approved testimonials can be featured')
  }

  const set: Partial<typeof testimonial.$inferInsert> = { updatedAt: new Date() }
  if (body.status !== undefined) {
    set.status = body.status
    set.moderatedAt = new Date()
    set.moderatedByUserId = session.user.id
    // Leaving the approved state always clears the featured flag.
    if (body.status !== 'approved') set.featured = false
  }
  if (body.featured !== undefined && (body.status === undefined || body.status === 'approved')) {
    set.featured = body.featured
  }

  const [updated] = await db
    .update(testimonial)
    .set(set)
    .where(and(eq(testimonial.id, id), eq(testimonial.projectId, projectId)))
    .returning({
      id: testimonial.id,
      status: testimonial.status,
      featured: testimonial.featured,
      consentPublic: testimonial.consentPublic,
    })
  if (!updated) notFound('Testimonial not found')

  return createSuccessResponse(updated)
})
