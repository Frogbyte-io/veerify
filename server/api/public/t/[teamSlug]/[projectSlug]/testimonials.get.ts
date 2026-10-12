/**
 * @openapi
 * /api/public/t/{teamSlug}/{projectSlug}/testimonials:
 *   get:
 *     tags: [Public]
 *     summary: Public testimonial wall
 *     description: >
 *       Approved testimonials whose author consented to public display, featured first.
 *       Only name, title, company, quote, rating and date are returned.
 *     operationId: listPublicTestimonials
 *     parameters:
 *       - in: path
 *         name: teamSlug
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: projectSlug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Testimonials }
 *       403: { description: Product is not public }
 *       404: { description: Team or product not found, or Marketing is off }
 */
import { and, desc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { testimonial } from '~/server/database/schema/marketing'
import { resolvePublicProjectByTeam } from '~/server/utils/project-access'
import { isModuleEnabledForProject } from '~/server/utils/public-modules'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'

const MAX_PUBLIC_TESTIMONIALS = 100

export default defineEventHandler(async (event) => {
  const teamSlug = getRouterParam(event, 'teamSlug')
  const projectSlug = getRouterParam(event, 'projectSlug')
  const { team: t, project: proj } = await resolvePublicProjectByTeam(teamSlug!, projectSlug!)

  // Marketing must be on for the team and the product; otherwise indistinguishable from none
  if (!(await isModuleEnabledForProject(t.id, proj.settings as Record<string, unknown> | null, 'marketingEnabled'))) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Testimonials are not available for this product'),
    })
  }

  // Never select authorEmail or moderation fields: this endpoint is anonymous.
  const items = await db
    .select({
      id: testimonial.id,
      authorName: testimonial.authorName,
      authorTitle: testimonial.authorTitle,
      authorCompany: testimonial.authorCompany,
      quote: testimonial.quote,
      rating: testimonial.rating,
      createdAt: testimonial.createdAt,
    })
    .from(testimonial)
    .where(
      and(eq(testimonial.projectId, proj.id), eq(testimonial.status, 'approved'), eq(testimonial.consentPublic, true))
    )
    .orderBy(desc(testimonial.featured), desc(testimonial.createdAt), desc(testimonial.id))
    .limit(MAX_PUBLIC_TESTIMONIALS)

  return createSuccessResponse({ items })
})
