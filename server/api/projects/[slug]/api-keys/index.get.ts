/**
 * @openapi
 * /api/projects/{slug}/api-keys:
 *   get:
 *     tags: [Projects]
 *     summary: List app keys for a project
 *     description: "Returns key metadata with the product each key posts to, newest first. The key secret and hash are never returned."
 *     operationId: listProjectApiKeys
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "App key summaries" }
 *       403: { description: "Not a project admin" }
 *       404: { description: "Project not found" }
 */
import { desc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { product, projectApiKey } from '~/server/database/schema/feedback'
import { createSuccessResponse } from '~/server/utils/response'
import { requireProjectBySlug } from '~/server/utils/project-categories'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })

  const keys = await db
    .select({
      id: projectApiKey.id,
      name: projectApiKey.name,
      keyPrefix: projectApiKey.keyPrefix,
      productId: projectApiKey.productId,
      productName: product.name,
      createdAt: projectApiKey.createdAt,
      lastUsedAt: projectApiKey.lastUsedAt,
      revokedAt: projectApiKey.revokedAt,
    })
    .from(projectApiKey)
    .innerJoin(product, eq(projectApiKey.productId, product.id))
    .where(eq(projectApiKey.projectId, project.id))
    .orderBy(desc(projectApiKey.createdAt))

  return createSuccessResponse(keys)
})
