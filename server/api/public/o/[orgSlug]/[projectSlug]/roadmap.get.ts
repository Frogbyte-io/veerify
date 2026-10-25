/**
 * @openapi
 * /api/public/o/{orgSlug}/{projectSlug}/roadmap:
 *   get:
 *     tags: [Public]
 *     summary: Public roadmap of a project
 *     description: >
 *       Non-hidden feedback grouped by status, across the project's public
 *       products (or one product with `product`). Items of private products
 *       are never included. 404 when the Roadmap tool is off.
 *     operationId: getPublicRoadmap
 *     parameters:
 *       - { in: path, name: orgSlug, required: true, schema: { type: string } }
 *       - { in: path, name: projectSlug, required: true, schema: { type: string } }
 *       - { in: query, name: product, description: Product slug, schema: { type: string } }
 *     responses:
 *       200: { description: "`{ project, organization, products, columns }`" }
 *       403: { description: Project is not public }
 *       404: { description: Not found, product private, or Roadmap disabled }
 */
import { and, eq, desc, inArray } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { listPublicProducts, requirePublicProduct, resolvePublicProject } from '~/server/utils/project-access'
import { isModuleEnabledForProject } from '~/server/utils/public-modules'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory, feedbackStatus } from '~/server/database/schema/feedback'
import { SYSTEM_STATUSES } from '~/server/utils/project-statuses'

export default defineEventHandler(async (event) => {
  const orgSlug = getRouterParam(event, 'orgSlug')
  const projectSlug = getRouterParam(event, 'projectSlug')

  const { organization: org, project: proj } = await resolvePublicProject(orgSlug!, projectSlug!)

  // A disabled roadmap is indistinguishable from none
  if (!isModuleEnabledForProject(proj.settings as Record<string, unknown> | null, 'roadmapEnabled')) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Roadmap is not available for this project'),
    })
  }

  const products = await listPublicProducts(proj.id)
  const productParam = getQuery(event).product
  const filterProduct =
    typeof productParam === 'string' && productParam ? await requirePublicProduct(proj, productParam) : null
  const visibleProductIds = filterProduct ? [filterProduct.id] : products.map((p) => p.id)

  // Load custom statuses for this project, falling back to system defaults
  const customStatuses = await db
    .select()
    .from(feedbackStatus)
    .where(eq(feedbackStatus.projectId, proj.id))
    .orderBy(feedbackStatus.sortOrder)

  const statuses = customStatuses.length > 0 ? customStatuses : SYSTEM_STATUSES

  // Visible feedback of the project's public products, with categories
  const items =
    visibleProductIds.length === 0
      ? []
      : await db
          .select({ feedback: feedback, category: feedbackCategory })
          .from(feedback)
          .leftJoin(feedbackCategory, eq(feedback.categoryId, feedbackCategory.id))
          .where(
            and(
              eq(feedback.projectId, proj.id),
              eq(feedback.isHidden, false),
              inArray(feedback.productId, visibleProductIds)
            )
          )
          .orderBy(desc(feedback.isPinned), desc(feedback.voteCount))

  // Group feedback by status
  const grouped: Record<string, typeof items> = {}
  for (const item of items) {
    const s = item.feedback.status
    if (!grouped[s]) grouped[s] = []
    grouped[s].push(item)
  }

  const columns = statuses.map((status) => ({
    value: status.value,
    name: status.name,
    color: status.color,
    description: (status as any).description ?? null,
    sortOrder: status.sortOrder,
    items: (grouped[status.value] || []).map((item) => ({
      id: item.feedback.id,
      productId: item.feedback.productId,
      title: item.feedback.metadata?.source === 'support_conversation' ? 'Support request' : item.feedback.title,
      body: item.feedback.metadata?.source === 'support_conversation' ? null : item.feedback.body,
      status: item.feedback.status,
      tag: item.feedback.metadata?.feedbackType || null,
      voteCount: item.feedback.voteCount,
      commentCount: item.feedback.commentCount,
      authorName: item.feedback.metadata?.source === 'support_conversation' ? null : item.feedback.authorName,
      isPinned: item.feedback.isPinned,
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

  return createSuccessResponse({
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
    },
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      isPublic: p.isPublic,
      sortOrder: p.sortOrder,
    })),
    columns,
  })
})
