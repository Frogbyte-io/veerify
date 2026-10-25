import { count, eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackCategory } from '~/server/database/schema/feedback'
import { organization } from '~/server/database/schema/auth'
import { listProducts } from '~/server/utils/project-access'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { toProductSummary } from '~/server/utils/project-summary'

export default defineEventHandler(async (event) => {
  const { project, role } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '')

  const [[feedbackCount], categories, products, [org]] = await Promise.all([
    db.select({ count: count() }).from(feedback).where(eq(feedback.projectId, project.id)),
    db.select().from(feedbackCategory).where(eq(feedbackCategory.projectId, project.id)),
    listProducts(project.id),
    db.select().from(organization).where(eq(organization.id, project.organizationId)).limit(1),
  ])

  return createSuccessResponse({
    ...project,
    role,
    feedbackCount: feedbackCount?.count || 0,
    organization: org ? { id: org.id, name: org.name, slug: org.slug } : null,
    products: products.map(toProductSummary),
    categories,
  })
})
