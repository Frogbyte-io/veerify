/**
 * @openapi
 * /api/feedback/scope:
 *   get:
 *     tags: [Feedback]
 *     summary: Feedback summary per project
 *     description: >
 *       For each project in the caller's scope with the Feedback tool switched on, returns the number of feedback items, the products and the feedback statuses (custom when defined, else the system statuses). Powers the combined Feedback page in All projects: the project filter chips with counts, the status filter and the project/product picker. In a single project the scope is just the active project. Narrow with `projects` (comma-separated ids; an id outside the scope is 403). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: getFeedbackScope
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: projects
 *         description: "Comma-separated project ids to narrow to. Empty = every project in the scope"
 *         schema: { type: string }
 *     responses:
 *       200: { description: "data.projects: array of { id, feedbackCount, products[{ id, name, slug }], statuses[{ value, name, color, sortOrder, isDefault }] }" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "A requested project is not in the current scope" }
 *       409: { description: "The caller can open no project; create one first" }
 */
import { asc, count, inArray } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackStatus, product } from '~/server/database/schema/feedback'
import { statusesByProject } from '~/server/utils/feedback-scope'
import { requireScopedProjects } from '~/server/utils/project-context'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { projects } = await requireScopedProjects(event, { module: 'feedbackEnabled' })
  const ids = projects.map((p) => p.id)
  if (ids.length === 0) return createSuccessResponse({ projects: [] })

  const [counts, products, statuses] = await Promise.all([
    db
      .select({ projectId: feedback.projectId, count: count() })
      .from(feedback)
      .where(inArray(feedback.projectId, ids))
      .groupBy(feedback.projectId),
    db
      .select({ id: product.id, projectId: product.projectId, name: product.name, slug: product.slug })
      .from(product)
      .where(inArray(product.projectId, ids))
      .orderBy(asc(product.sortOrder), asc(product.createdAt), asc(product.id)),
    db
      .select()
      .from(feedbackStatus)
      .where(inArray(feedbackStatus.projectId, ids))
      .orderBy(asc(feedbackStatus.sortOrder), asc(feedbackStatus.createdAt), asc(feedbackStatus.id)),
  ])

  const countById = new Map(counts.map((row) => [row.projectId, row.count]))
  const statusIndex = statusesByProject(statuses, ids)

  return createSuccessResponse({
    projects: ids.map((id) => ({
      id,
      feedbackCount: countById.get(id) ?? 0,
      products: products
        .filter((p) => p.projectId === id)
        .map(({ id: productId, name, slug }) => ({ id: productId, name, slug })),
      statuses: statusIndex[id] ?? [],
    })),
  })
})
