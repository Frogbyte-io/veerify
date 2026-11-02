/**
 * @openapi
 * /api/roadmap/combined:
 *   get:
 *     tags: [Roadmap]
 *     summary: Combined roadmap board across projects (project members)
 *     description: >
 *       The roadmap of every project in the caller's scope that has the Roadmap tool on: the active project
 *       in single-project mode, every project they can open in All projects. Narrow it with `projects`
 *       (comma-separated project ids; an id outside the scope is 403). Columns are merged by status `value`:
 *       the first project's name and colour win, and a status only one of several projects has is marked with
 *       `onlyProject`. `projectIds` lists the projects that have the status; an item can only be moved into a
 *       column whose `projectIds` contains its project. Like the single-project board this includes hidden
 *       items (flagged `isHidden`). Each item carries `project` and `productId`; `products` lists the products
 *       of the projects in view. Moving an item still goes through `PATCH /api/feedback/{id}/status`.
 *     operationId: getCombinedRoadmap
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: projects
 *         description: Comma-separated project ids to narrow the scope to
 *         schema: { type: string }
 *     responses:
 *       200: { description: "`columns` (merged by status, with items), `projects` (id, name, slug, publicUrl), `products` and `counts` (visible items per project of the whole scope, for the filter chips)" }
 *       401: { description: Not authenticated }
 *       403: { description: A requested project is outside the caller's scope }
 *       409: { description: The caller can open no project }
 */
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { requireScopedProjects } from '~/server/utils/project-context'
import { createSuccessResponse } from '~/server/utils/response'
import { db } from '~/server/database/drizzle'
import { organization } from '~/server/database/schema/auth'
import { feedback, feedbackCategory, feedbackStatus, product } from '~/server/database/schema/feedback'
import { SYSTEM_STATUSES } from '~/server/utils/project-statuses'
import { buildPublicBoardUrl } from '~/lib/public-board-url'
import { isModuleEnabled } from '~/lib/modules'
import { mergeRoadmapColumns, type RoadmapStatus } from '~/lib/roadmap-combined'

export default defineEventHandler(async (event) => {
  const { projects, scopeProjects } = await requireScopedProjects(event, { module: 'roadmapEnabled' })
  if (projects.length === 0) return createSuccessResponse({ columns: [], projects: [], products: [], counts: {} })

  const projectIds = projects.map((p) => p.id)
  const countProjectIds = scopeProjects
    .filter((p) => isModuleEnabled(p.settings as Record<string, unknown> | null, 'roadmapEnabled'))
    .map((p) => p.id)
  const [statusRows, items, productRows, [org], countRows] = await Promise.all([
    db
      .select()
      .from(feedbackStatus)
      .where(inArray(feedbackStatus.projectId, projectIds))
      .orderBy(asc(feedbackStatus.sortOrder)),
    db
      .select({ feedback: feedback, category: feedbackCategory })
      .from(feedback)
      .leftJoin(feedbackCategory, eq(feedback.categoryId, feedbackCategory.id))
      .where(inArray(feedback.projectId, projectIds))
      .orderBy(desc(feedback.isPinned), desc(feedback.voteCount)),
    db
      .select()
      .from(product)
      .where(inArray(product.projectId, projectIds))
      .orderBy(asc(product.sortOrder), asc(product.createdAt), asc(product.id)),
    db
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, projects[0]!.organizationId))
      .limit(1),
    // Per-project counts for the filter chips cover the whole scope, not only the narrowed projects
    db
      .select({ projectId: feedback.projectId, count: sql<number>`count(*)::int` })
      .from(feedback)
      .where(and(inArray(feedback.projectId, countProjectIds), ne(feedback.isHidden, true)))
      .groupBy(feedback.projectId),
  ])

  const statusesByProject = new Map<string, RoadmapStatus[]>()
  for (const row of statusRows) {
    const list = statusesByProject.get(row.projectId) ?? []
    list.push({
      value: row.value,
      name: row.name,
      color: row.color,
      description: row.description,
      sortOrder: row.sortOrder,
    })
    statusesByProject.set(row.projectId, list)
  }

  const itemsByProject = new Map<string, typeof items>()
  for (const item of items) {
    const list = itemsByProject.get(item.feedback.projectId) ?? []
    list.push(item)
    itemsByProject.set(item.feedback.projectId, list)
  }

  const columns = mergeRoadmapColumns(
    projects.map((proj) => ({
      project: { id: proj.id, name: proj.name, slug: proj.slug },
      statuses: statusesByProject.get(proj.id) ?? SYSTEM_STATUSES,
      items: (itemsByProject.get(proj.id) ?? []).map((item) => ({
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
  )

  const requestUrl = getRequestURL(event)
  const appDomain = useRuntimeConfig().public.appDomain || 'localhost'
  return createSuccessResponse({
    columns,
    projects: projects.map((proj) => ({
      id: proj.id,
      name: proj.name,
      slug: proj.slug,
      publicUrl: proj.isPublic
        ? `${buildPublicBoardUrl({
            project: { slug: proj.slug, customDomain: proj.customDomain, settings: proj.settings },
            orgSlug: org?.slug,
            projectSlug: proj.slug,
            appDomain,
            protocol: requestUrl.protocol,
            port: requestUrl.port,
          })}/roadmap`
        : null,
    })),
    products: productRows.map((p) => ({ id: p.id, projectId: p.projectId, name: p.name, slug: p.slug })),
    counts: Object.fromEntries(countRows.map((row) => [row.projectId, row.count])),
  })
})
