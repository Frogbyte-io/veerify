/**
 * @openapi
 * /api/projects/{slug}/categories:
 *   post:
 *     tags: [Projects]
 *     summary: Create category
 *     description: >
 *       Creates a feedback category; the slug is derived from the name. Project admins only (organization owners and admins count as project admins). The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: createProjectCategory
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         description: "Project slug"
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, minLength: 1, maxLength: 80 }
 *               icon: { type: string, maxLength: 32, nullable: true }
 *               color: { type: string, pattern: "^#[0-9a-fA-F]{6}$", nullable: true, description: "Default #6b7280" }
 *               description: { type: string, maxLength: 200, nullable: true }
 *               sortOrder: { type: integer, minimum: 0, description: "Defaults to last" }
 *     responses:
 *       201: { description: "Created category" }
 *       400: { description: "Validation failed or invalid name" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not a project admin" }
 *       404: { description: "Project not found in the active workspace" }
 */
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
  const { project } = await requireProjectCategoryAccess(event, { admin: true })
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
