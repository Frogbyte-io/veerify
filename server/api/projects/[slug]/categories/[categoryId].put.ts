/**
 * @openapi
 * /api/projects/{slug}/categories/{categoryId}:
 *   put:
 *     tags: [Projects]
 *     summary: Update category
 *     description: >
 *       Updates a category; renaming regenerates its slug. Project admins only (organization owners and admins count as project admins). The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: updateProjectCategory
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         description: "Project slug"
 *         schema: { type: string }
 *       - in: path
 *         name: categoryId
 *         required: true
 *         description: "Category id"
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, minLength: 1, maxLength: 80 }
 *               icon: { type: string, maxLength: 32, nullable: true }
 *               color: { type: string, pattern: "^#[0-9a-fA-F]{6}$", nullable: true }
 *               description: { type: string, maxLength: 200, nullable: true }
 *               sortOrder: { type: integer, minimum: 0 }
 *     responses:
 *       200: { description: "Updated category" }
 *       400: { description: "Validation failed" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not a project admin" }
 *       404: { description: "Project or category not found" }
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { feedbackCategory } from '~/server/database/schema/feedback'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireProjectCategoryAccess, toCategorySlug } from '~/server/utils/project-categories'

const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  icon: z.string().trim().max(32).nullable().optional(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  description: z.string().trim().max(200).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
})

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectCategoryAccess(event, { admin: true })
  const categoryId = getRouterParam(event, 'categoryId')
  if (!categoryId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Category ID is required'),
    })
  }

  const body = await validateBody(event, updateCategorySchema)

  const [current] = await db
    .select()
    .from(feedbackCategory)
    .where(and(eq(feedbackCategory.id, categoryId), eq(feedbackCategory.projectId, project.id)))
    .limit(1)

  if (!current) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Category not found'),
    })
  }

  let slug = current.slug
  if (body.name && body.name !== current.name) {
    const baseSlug = toCategorySlug(body.name)
    const siblingSlugs = await db
      .select({ slug: feedbackCategory.slug })
      .from(feedbackCategory)
      .where(eq(feedbackCategory.projectId, project.id))

    const used = new Set(siblingSlugs.filter((item) => item.slug !== current.slug).map((item) => item.slug))
    slug = baseSlug
    let suffix = 2
    while (used.has(slug)) {
      slug = `${baseSlug}-${suffix++}`
    }
  }

  const [updated] = await db
    .update(feedbackCategory)
    .set({
      name: body.name ?? current.name,
      slug,
      icon: body.icon === undefined ? current.icon : body.icon,
      color: body.color === undefined ? current.color : body.color,
      description: body.description === undefined ? current.description : body.description,
      sortOrder: body.sortOrder ?? current.sortOrder,
    })
    .where(and(eq(feedbackCategory.id, categoryId), eq(feedbackCategory.projectId, project.id)))
    .returning()

  return createSuccessResponse(updated)
})
