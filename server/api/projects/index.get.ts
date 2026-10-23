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
