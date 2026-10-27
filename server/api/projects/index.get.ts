/**
 * @openapi
 * /api/projects:
 *   get:
 *     tags: [Projects]
 *     summary: List projects
 *     description: >
 *       Lists the projects the caller can open in the active organization, each with its product count. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: listProjects
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     responses:
 *       200: { description: "Array of project summaries (id, name, slug, description, isPublic, accessMode, role, organizationId) plus productCount" }
 *       401: { description: "Not authenticated" }
 *       409: { description: "No active organization" }
 */
import { inArray, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { product } from '~/server/database/schema/feedback'
import { listAccessibleProjects } from '~/server/utils/project-access'
import { requireAuthWithOrganization } from '~/server/utils/project-context'
import { toProjectSummary } from '~/server/utils/project-summary'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { session, organizationId } = await requireAuthWithOrganization(event)
  const projects = await listAccessibleProjects(organizationId, session.user.id)

  const counts =
    projects.length > 0
      ? await db
          .select({ projectId: product.projectId, count: sql<number>`count(*)::int` })
          .from(product)
          .where(
            inArray(
              product.projectId,
              projects.map((p) => p.id)
            )
          )
          .groupBy(product.projectId)
      : []
  const countByProject = new Map(counts.map((row) => [row.projectId, row.count]))

  return createSuccessResponse(
    projects.map((p) => ({ ...toProjectSummary(p), productCount: countByProject.get(p.id) ?? 0 }))
  )
})
