/**
 * @openapi
 * /api/marketing/projects/{projectId}/testimonials:
 *   get:
 *     tags: [Marketing]
 *     summary: List testimonials for moderation
 *     description: Newest first, with counts by status and the workspace slug (for the public wall link). Includes whether the author consented to public display.
 *     operationId: listMarketingTestimonials
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, approved, rejected] }
 *     responses:
 *       200: { description: Testimonials and counts }
 *       400: { description: Invalid query }
 *       403: { description: No access to this project, or Marketing is not enabled }
 *       404: { description: Product not found }
 */
import { and, count, desc, eq, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { testimonial } from '~/server/database/schema/marketing'
import { getOrganizationSlug } from '~/server/utils/marketing-public-url'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { requireRouterParam } from '~/server/utils/marketing-mentions'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { validateQuery } from '~/server/utils/validation'

const querySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
})

const MAX_ITEMS = 200

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouterParam(event, 'projectId', 'Project ID')
  const { project, organizationId } = await requireMarketingAccess(projectId, session.user.id)
  const query = validateQuery(event, querySchema)

  const conditions: SQL[] = [eq(testimonial.projectId, projectId)]
  if (query.status) conditions.push(eq(testimonial.status, query.status))

  const [items, statusRows, orgSlug] = await Promise.all([
    db
      .select({
        id: testimonial.id,
        authorName: testimonial.authorName,
        authorTitle: testimonial.authorTitle,
        authorCompany: testimonial.authorCompany,
        authorEmail: testimonial.authorEmail,
        quote: testimonial.quote,
        rating: testimonial.rating,
        consentPublic: testimonial.consentPublic,
        status: testimonial.status,
        featured: testimonial.featured,
        createdAt: testimonial.createdAt,
      })
      .from(testimonial)
      .where(and(...conditions))
      .orderBy(desc(testimonial.createdAt), desc(testimonial.id))
      .limit(MAX_ITEMS),
    db
      .select({ status: testimonial.status, total: count() })
      .from(testimonial)
      .where(eq(testimonial.projectId, projectId))
      .groupBy(testimonial.status),
    // The workspace and project slugs build the public wall link in the UI.
    getOrganizationSlug(organizationId),
  ])

  const counts = { pending: 0, approved: 0, rejected: 0 }
  for (const row of statusRows) counts[row.status] = Number(row.total)

  return createSuccessResponse({ items, counts, orgSlug, projectSlug: project.slug })
})
