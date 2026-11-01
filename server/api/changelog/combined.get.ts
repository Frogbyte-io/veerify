/**
 * @openapi
 * /api/changelog/combined:
 *   get:
 *     tags: [Changelog]
 *     summary: Combined changelog timeline across projects
 *     description: >
 *       The changelog entries of every project in the caller's scope that has the Changelog tool on: the
 *       active project in single-project mode, every project they can open in All projects. One timeline,
 *       newest first, drafts included (`status: draft`). Narrow it with `projects` (comma-separated project
 *       ids; an id outside the scope is 403). Each entry carries `projectId` and `project` (id, name, slug);
 *       the body is omitted. `products` lists the products of the projects in view, to resolve `productIds`.
 *       Open or change an entry with the per-project endpoints under `/api/changelog/projects/{projectId}`.
 *     operationId: listCombinedChangelogEntries
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: projects
 *         description: Comma-separated project ids to narrow the scope to
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, published] }
 *       - in: query
 *         name: cursor
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100 }
 *     responses:
 *       200: { description: "`entries` (newest first), `nextCursor`, `products` and `counts` (entries per project of the whole scope, for the filter chips)" }
 *       401: { description: Not authenticated }
 *       403: { description: A requested project is outside the caller's scope }
 *       409: { description: The caller can open no project }
 */
import { asc, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { requireScopedProjects } from '~/server/utils/project-context'
import { createSuccessResponse } from '~/server/utils/response'
import { validateQuery } from '~/server/utils/validation'
import { listEntriesAcrossProjects } from '~/server/utils/changelog-combined'
import { loadEntryProductIds, serializeEntry } from '~/server/services/changelog/entries'
import { listQuerySchema } from '~/server/services/changelog/schemas'
import { db } from '~/server/database/drizzle'
import { product } from '~/server/database/schema/feedback'
import { changelogEntry } from '~/server/database/schema/changelog'
import { isModuleEnabled } from '~/lib/modules'

const combinedQuerySchema = listQuerySchema.omit({ productId: true }).extend({ projects: z.string().optional() })

export default defineEventHandler(async (event) => {
  const { projects, scopeProjects } = await requireScopedProjects(event, { module: 'changelogEnabled' })
  const query = validateQuery(event, combinedQuerySchema)
  if (projects.length === 0) return createSuccessResponse({ entries: [], nextCursor: null, products: [], counts: {} })

  const projectIds = projects.map((p) => p.id)
  const { entries, nextCursor } = await listEntriesAcrossProjects(projectIds, query)
  const countProjectIds = scopeProjects
    .filter((p) => isModuleEnabled(p.settings as Record<string, unknown> | null, 'changelogEnabled'))
    .map((p) => p.id)
  const [productIds, productRows, countRows] = await Promise.all([
    loadEntryProductIds(entries.map((row) => row.id)),
    db
      .select()
      .from(product)
      .where(inArray(product.projectId, projectIds))
      .orderBy(asc(product.sortOrder), asc(product.createdAt), asc(product.id)),
    // Per-project counts for the filter chips cover the whole scope, not only the narrowed projects
    db
      .select({ projectId: changelogEntry.projectId, count: sql<number>`count(*)::int` })
      .from(changelogEntry)
      .where(inArray(changelogEntry.projectId, countProjectIds))
      .groupBy(changelogEntry.projectId),
  ])
  const byId = new Map(projects.map((p) => [p.id, { id: p.id, name: p.name, slug: p.slug }]))

  return createSuccessResponse({
    entries: entries.map((row) => ({
      ...serializeEntry(row, productIds.get(row.id) ?? []),
      body: undefined,
      project: byId.get(row.projectId),
    })),
    nextCursor,
    products: productRows.map((p) => ({ id: p.id, projectId: p.projectId, name: p.name, slug: p.slug })),
    counts: Object.fromEntries(countRows.map((row) => [row.projectId, row.count])),
  })
})
