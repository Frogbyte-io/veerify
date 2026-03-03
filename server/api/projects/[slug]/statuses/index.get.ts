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
    return createSuccessResponse(SYSTEM_STATUSES.map((s) => ({ ...s, id: null, projectId: project.id, createdAt: null })))
  }

  return createSuccessResponse(statuses)
})
