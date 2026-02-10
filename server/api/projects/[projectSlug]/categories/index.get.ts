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
