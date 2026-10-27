/**
 * @openapi
 * /api/projects/{slug}:
 *   get:
 *     tags: [Projects]
 *     summary: Get project
 *     description: >
 *       Returns a project with the caller's role, feedback count, organization, products and categories. The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: getProject
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         description: "Project slug"
 *         schema: { type: string }
 *     responses:
 *       200: { description: "Project row plus role, feedbackCount, organization, products and categories" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "No access to the project" }
 *       404: { description: "Project not found in the active workspace" }
 */
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
