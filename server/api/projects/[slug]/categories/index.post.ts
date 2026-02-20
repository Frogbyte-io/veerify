import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { feedbackCategory } from '~/server/database/schema/feedback'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireProjectCategoryAccess, toCategorySlug } from '~/server/utils/project-categories'

const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  icon: z.string().trim().max(32).optional().nullable(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .nullable(),
  description: z.string().trim().max(200).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
})

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectCategoryAccess(event)
  const body = await validateBody(event, createCategorySchema)

  const baseSlug = toCategorySlug(body.name)
  if (!baseSlug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Category name is invalid'),
    })
  }

  const categories = await db
    .select({ slug: feedbackCategory.slug })
    .from(feedbackCategory)
    .where(eq(feedbackCategory.projectId, project.id))

  let slug = baseSlug
  const existing = new Set(categories.map((category) => category.slug))
  let suffix = 2
  while (existing.has(slug)) {
    slug = `${baseSlug}-${suffix++}`
  }

  const [lastCategory] = await db
    .select({ sortOrder: feedbackCategory.sortOrder })
    .from(feedbackCategory)
    .where(eq(feedbackCategory.projectId, project.id))
    .orderBy(desc(feedbackCategory.sortOrder))
    .limit(1)

  const nextOrder = body.sortOrder ?? (lastCategory?.sortOrder ?? -1) + 1

  const [created] = await db
    .insert(feedbackCategory)
    .values({
      id: crypto.randomUUID(),
      projectId: project.id,
      name: body.name,
      slug,
      icon: body.icon || null,
      color: body.color || '#6b7280',
      description: body.description || null,
      sortOrder: nextOrder,
      isDefault: false,
      createdAt: new Date(),
    })
    .returning()

  setResponseStatus(event, 201)
  return createSuccessResponse(created)
})
