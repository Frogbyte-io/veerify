import { desc, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { changelogPost } from '~/server/database/schema/changelog'
import { createSuccessResponse } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectCategoryAccess(event)
  const posts = await db
    .select()
    .from(changelogPost)
    .where(eq(changelogPost.projectId, project.id))
    .orderBy(desc(changelogPost.publishedAt), desc(changelogPost.createdAt))

  return createSuccessResponse(posts)
})
