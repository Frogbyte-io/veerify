/**
 * @openapi
 * /api/roadmap/projects/{projectId}:
 *   get:
 *     tags: [Roadmap]
 *     summary: Roadmap board of a project (project members)
 *     description: >
 *       Feedback grouped by status, one column per status, across all products
 *       of the project (or one product with `productId`). Unlike the public
 *       roadmap this includes hidden items (flagged `isHidden`) and real titles
 *       of support-derived items. Items carry `productId`.
 *     operationId: getRoadmapBoard
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: productId
 *         description: Only items of this product
 *         schema: { type: string }
 *     responses:
 *       200: { description: Columns with items, the project's products, and the public roadmap URL when the project is public }
 *       403: { description: No access to the project, or Roadmap is off }
 *       404: { description: Project or product not found }
 */
import { and, eq, desc } from 'drizzle-orm'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireRoadmapAccess } from '~/server/utils/roadmap-access'
import { createSuccessResponse } from '~/server/utils/response'
import { requireRouteParam } from '~/server/utils/marketing-site'
import { db } from '~/server/database/drizzle'
import { organization } from '~/server/database/schema/auth'
import { listProducts, requireProductInProject } from '~/server/utils/project-access'
import { feedback, feedbackCategory, feedbackStatus } from '~/server/database/schema/feedback'
import { SYSTEM_STATUSES } from '~/server/utils/project-statuses'
import { buildPublicBoardUrl } from '~/lib/public-board-url'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  const { project: proj } = await requireRoadmapAccess(projectId, session.user.id)

  const customStatuses = await db
    .select()
    .from(feedbackStatus)
    .where(eq(feedbackStatus.projectId, proj.id))
    .orderBy(feedbackStatus.sortOrder)
  const statuses = customStatuses.length > 0 ? customStatuses : SYSTEM_STATUSES

  const productIdParam = getQuery(event).productId
  const filterProduct =
    typeof productIdParam === 'string' && productIdParam ? await requireProductInProject(proj.id, productIdParam) : null
  const products = await listProducts(proj.id)

  const items = await db
    .select({ feedback: feedback, category: feedbackCategory })
    .from(feedback)
    .leftJoin(feedbackCategory, eq(feedback.categoryId, feedbackCategory.id))
    .where(and(eq(feedback.projectId, proj.id), filterProduct ? eq(feedback.productId, filterProduct.id) : undefined))
    .orderBy(desc(feedback.isPinned), desc(feedback.voteCount))

  const grouped: Record<string, typeof items> = {}
  for (const item of items) {
    const s = item.feedback.status
    if (!grouped[s]) grouped[s] = []
    grouped[s]!.push(item)
  }

  const columns = statuses.map((status) => ({
    value: status.value,
    name: status.name,
    color: status.color,
    description: (status as { description?: string | null }).description ?? null,
    sortOrder: status.sortOrder,
    items: (grouped[status.value] || []).map((item) => ({
      id: item.feedback.id,
      productId: item.feedback.productId,
      title: item.feedback.title,
      status: item.feedback.status,
      voteCount: item.feedback.voteCount,
      commentCount: item.feedback.commentCount,
      isPinned: item.feedback.isPinned,
      isHidden: item.feedback.isHidden === true,
      fromSupport: item.feedback.metadata?.source === 'support_conversation',
      createdAt: item.feedback.createdAt,
      category: item.category
        ? {
            id: item.category.id,
            name: item.category.name,
            slug: item.category.slug,
            icon: item.category.icon,
            color: item.category.color,
          }
        : null,
    })),
  }))

  let publicUrl: string | null = null
  if (proj.isPublic) {
    const [org] = await db
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, proj.organizationId))
      .limit(1)
    const requestUrl = getRequestURL(event)
    const base = buildPublicBoardUrl({
      project: { slug: proj.slug, customDomain: proj.customDomain, settings: proj.settings },
      orgSlug: org?.slug,
      projectSlug: proj.slug,
      appDomain: useRuntimeConfig().public.appDomain || 'localhost',
      protocol: requestUrl.protocol,
      port: requestUrl.port,
    })
    publicUrl = `${base}/roadmap${filterProduct?.isPublic ? `?product=${filterProduct.slug}` : ''}`
  }

  return createSuccessResponse({
    project: { id: proj.id, name: proj.name, slug: proj.slug, isPublic: proj.isPublic === true },
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      isPublic: p.isPublic,
      sortOrder: p.sortOrder,
    })),
    publicUrl,
    columns,
  })
})
