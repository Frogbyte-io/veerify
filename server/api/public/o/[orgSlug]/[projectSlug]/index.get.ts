/**
 * @openapi
 * /api/public/o/{orgSlug}/{projectSlug}:
 *   get:
 *     tags: [Public]
 *     summary: A public project with its public products, tools and branding
 *     description: >
 *       Stats and counts only cover non-hidden feedback of public products.
 *       Private products are not listed.
 *     operationId: getPublicProject
 *     parameters:
 *       - { in: path, name: orgSlug, required: true, schema: { type: string } }
 *       - { in: path, name: projectSlug, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: "`{ project, organization, products, modules, categories, stats, hasTestimonials }`" }
 *       403: { description: Project is not public }
 *       404: { description: Workspace or project not found }
 */
import { and, eq, count, inArray } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { listPublicProducts, resolvePublicProject } from '~/server/utils/project-access'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory } from '~/server/database/schema/feedback'
import { testimonial } from '~/server/database/schema/marketing'
import { isModuleEnabledForProject } from '~/server/utils/public-modules'
import { resolveProjectModules } from '~/lib/modules'

export default defineEventHandler(async (event) => {
  const orgSlug = getRouterParam(event, 'orgSlug')
  const projectSlug = getRouterParam(event, 'projectSlug')

  const { organization: org, project: proj } = await resolvePublicProject(orgSlug!, projectSlug!)

  const products = await listPublicProducts(proj.id)
  const productIds = products.map((p) => p.id)
  const visibleFeedback =
    productIds.length > 0
      ? and(eq(feedback.projectId, proj.id), eq(feedback.isHidden, false), inArray(feedback.productId, productIds))
      : undefined

  const perProduct = new Map<string, number>()
  const statusMap: Record<string, number> = {}
  if (visibleFeedback) {
    const byProduct = await db
      .select({ productId: feedback.productId, count: count() })
      .from(feedback)
      .where(visibleFeedback)
      .groupBy(feedback.productId)
    for (const row of byProduct) perProduct.set(row.productId, row.count)

    const statusCounts = await db
      .select({ status: feedback.status, count: count() })
      .from(feedback)
      .where(visibleFeedback)
      .groupBy(feedback.status)
    for (const s of statusCounts) statusMap[s.status] = s.count
  }
  const total = [...perProduct.values()].reduce((sum, n) => sum + n, 0)

  const categories = await db
    .select()
    .from(feedbackCategory)
    .where(eq(feedbackCategory.projectId, proj.id))
    .orderBy(feedbackCategory.sortOrder)

  // Drives the "Testimonials" tab: Marketing on for the project and at least one
  // approved, publicly consented testimonial. A single LIMIT 1 probe.
  let hasTestimonials = false
  if (isModuleEnabledForProject(proj.settings as Record<string, unknown> | null, 'marketingEnabled')) {
    const [visible] = await db
      .select({ id: testimonial.id })
      .from(testimonial)
      .where(
        and(eq(testimonial.projectId, proj.id), eq(testimonial.status, 'approved'), eq(testimonial.consentPublic, true))
      )
      .limit(1)
    hasTestimonials = Boolean(visible)
  }

  return createSuccessResponse({
    hasTestimonials,
    project: {
      id: proj.id,
      name: proj.name,
      slug: proj.slug,
      description: proj.description,
      customDomain: proj.customDomain,
      settings: proj.settings,
    },
    organization: {
      name: org.name,
      slug: org.slug,
      logo: org.logo,
    },
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      isPublic: p.isPublic,
      sortOrder: p.sortOrder,
      feedbackCount: perProduct.get(p.id) ?? 0,
    })),
    modules: resolveProjectModules(proj.settings as Record<string, unknown> | null),
    categories,
    stats: {
      total,
      open: statusMap.open || 0,
      inProgress: statusMap.in_progress || 0,
      planned: statusMap.planned || 0,
      completed: statusMap.completed || 0,
    },
  })
})
