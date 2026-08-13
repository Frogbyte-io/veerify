import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { project as projectTable } from '~/server/database/schema/feedback'
import { changelogPost } from '~/server/database/schema/changelog'
import { createSuccessResponse } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'
import { validateBody } from '~/server/utils/validation'

const createChangelogSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
  category: z.string().trim().max(100).nullable().optional(),
  isDraft: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectCategoryAccess(event)
  const body = await validateBody(event, createChangelogSchema)
  const now = new Date()

  const [created] = await db
    .insert(changelogPost)
    .values({
      id: crypto.randomUUID(),
      projectId: project.id,
      title: body.title,
      body: body.body,
      category: body.category || null,
      isDraft: body.isDraft !== false,
      publishedAt: body.isDraft === false ? now : null,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  const currentSettings =
    project.settings && typeof project.settings === 'object' ? (project.settings as Record<string, any>) : {}
  if (currentSettings.changelogEnabled !== true) {
    await db
      .update(projectTable)
      .set({
        settings: {
          ...currentSettings,
          changelogEnabled: true,
        },
        updatedAt: now,
      })
      .where(eq(projectTable.id, project.id))
  }

  return createSuccessResponse(created)
})
