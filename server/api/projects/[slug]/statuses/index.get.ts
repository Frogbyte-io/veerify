/**
 * @openapi
 * /api/projects/{slug}/statuses:
 *   get:
 *     tags: [Projects]
 *     summary: List statuses
 *     description: >
 *       Lists the project's feedback statuses; when none are customised, the system statuses are returned with null ids. The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: listProjectStatuses
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
 *       200: { description: "Array of statuses (id, name, value, color, description, sortOrder, isDefault)" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "No access to the project" }
 *       404: { description: "Project not found in the active workspace" }
 */
import { asc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedbackStatus } from '~/server/database/schema/feedback'
import { createSuccessResponse } from '~/server/utils/response'
import { requireProjectStatusAccess, SYSTEM_STATUSES } from '~/server/utils/project-statuses'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectStatusAccess(event)

  const statuses = await db
    .select()
    .from(feedbackStatus)
    .where(eq(feedbackStatus.projectId, project.id))
    .orderBy(asc(feedbackStatus.sortOrder), asc(feedbackStatus.createdAt))

  // If no custom statuses configured, return system defaults
  if (statuses.length === 0) {
    return createSuccessResponse(
      SYSTEM_STATUSES.map((s) => ({ ...s, id: null, projectId: project.id, createdAt: null }))
    )
  }

  return createSuccessResponse(statuses)
})
