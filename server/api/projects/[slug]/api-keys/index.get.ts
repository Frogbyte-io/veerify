/**
 * @openapi
 * /api/projects/{slug}/api-keys:
 *   get:
 *     tags: [Projects]
 *     summary: List app or server keys for a project
 *     description: "Returns key metadata newest first; app keys include the product they post to. The key secret and hash are never returned."
 *     operationId: listProjectApiKeys
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: kind
 *         required: false
 *         schema: { type: string, enum: [app, server], default: app }
 *         description: "`app` keys post feedback from apps; `server` keys submit website forms."
 *     responses:
 *       200: { description: "App key summaries" }
 *       403: { description: "Not a project admin" }
 *       404: { description: "Project not found" }
 */
import { and, desc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { product, projectApiKey } from '~/server/database/schema/feedback'
import { createSuccessResponse } from '~/server/utils/response'
import { requireProjectBySlug } from '~/server/utils/project-categories'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const kind = getQuery(event).kind === 'server' ? 'server' : 'app'

  const keys = await db
    .select({
      id: projectApiKey.id,
      name: projectApiKey.name,
      keyPrefix: projectApiKey.keyPrefix,
      kind: projectApiKey.kind,
      productId: projectApiKey.productId,
      productName: product.name,
      createdAt: projectApiKey.createdAt,
      lastUsedAt: projectApiKey.lastUsedAt,
      revokedAt: projectApiKey.revokedAt,
    })
    .from(projectApiKey)
    .leftJoin(product, eq(projectApiKey.productId, product.id))
    .where(and(eq(projectApiKey.projectId, project.id), eq(projectApiKey.kind, kind)))
    .orderBy(desc(projectApiKey.createdAt))

  return createSuccessResponse(keys)
})
