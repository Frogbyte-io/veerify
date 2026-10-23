/**
 * @openapi
 * /api/projects/{slug}/api-keys:
 *   get:
 *     tags: [Projects]
 *     summary: List app keys for a project
 *     description: "Returns key metadata newest first. The key secret and hash are never returned."
 *     operationId: listProjectApiKeys
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "App key summaries" }
 *       403: { description: "Not a team member" }
 *       404: { description: "Project not found" }
 */
import { desc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { projectApiKey } from '~/server/database/schema/feedback'
import { createSuccessResponse } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectCategoryAccess(event)

  const keys = await db
    .select({
      id: projectApiKey.id,
      name: projectApiKey.name,
      keyPrefix: projectApiKey.keyPrefix,
      createdAt: projectApiKey.createdAt,
      lastUsedAt: projectApiKey.lastUsedAt,
      revokedAt: projectApiKey.revokedAt,
    })
    .from(projectApiKey)
    .where(eq(projectApiKey.projectId, project.id))
    .orderBy(desc(projectApiKey.createdAt))

  return createSuccessResponse(keys)
})
