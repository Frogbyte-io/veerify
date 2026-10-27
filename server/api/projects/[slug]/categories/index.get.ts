/**
 * @openapi
 * /api/projects/{slug}/categories:
 *   get:
 *     tags: [Projects]
 *     summary: List categories
 *     description: >
 *       Lists the project's feedback categories ordered by sortOrder. The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: listProjectCategories
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
 *       200: { description: "Array of categories" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "No access to the project" }
 *       404: { description: "Project not found in the active workspace" }
 */
import { asc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedbackCategory } from '~/server/database/schema/feedback'
import { createSuccessResponse } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectCategoryAccess(event)

  const categories = await db
    .select()
    .from(feedbackCategory)
    .where(eq(feedbackCategory.projectId, project.id))
    .orderBy(asc(feedbackCategory.sortOrder), asc(feedbackCategory.createdAt))

  return createSuccessResponse(categories)
})
