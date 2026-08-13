import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { changelogPost } from '~/server/database/schema/changelog'
import { createSuccessResponse, createErrorResponse, ErrorCode } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'
import { validateBody } from '~/server/utils/validation'

const updateChangelogSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(20_000).optional(),
  category: z.string().trim().max(100).nullable().optional(),
  isDraft: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectCategoryAccess(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Changelog ID is required'),
    })
  }
  const body = await validateBody(event, updateChangelogSchema)

  const [updated] = await db
    .update(changelogPost)
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.body !== undefined ? { body: body.body } : {}),
      ...(body.category !== undefined ? { category: body.category || null } : {}),
      ...(body.isDraft !== undefined ? { isDraft: body.isDraft } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(changelogPost.id, id), eq(changelogPost.projectId, project.id)))
    .returning()

  if (!updated) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Changelog entry not found'),
    })
  }

  return createSuccessResponse(updated)
})
