/**
 * @openapi
 * /api/projects/{slug}/products/{productId}:
 *   put:
 *     tags: [Projects]
 *     summary: Update product
 *     description: >
 *       Updates a product. Project admins only (organization owners and admins count as project admins). The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: updateProjectProduct
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
 *         name: productId
 *         required: true
 *         description: "Product id"
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, minLength: 1, maxLength: 100 }
 *               slug: { type: string, minLength: 1, maxLength: 100, pattern: "^[a-z0-9-]+$" }
 *               description: { type: string, maxLength: 1000, nullable: true }
 *               isPublic: { type: boolean, description: "Public board flag" }
 *               sortOrder: { type: integer, minimum: 0, maximum: 10000 }
 *     responses:
 *       200: { description: "Updated product summary" }
 *       400: { description: "Validation failed or reserved slug" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not a project admin" }
 *       404: { description: "Project or product not found" }
 *       409: { description: "Slug already in use in the project" }
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { product } from '~/server/database/schema/feedback'
import { resolveProductSlug } from '~/server/utils/product-rules'
import { requireProductInProject } from '~/server/utils/project-access'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { toProductSummary } from '~/server/utils/project-summary'
import { createSuccessResponse } from '~/server/utils/response'
import { commonSchemas, validateBody } from '~/server/utils/validation'

const updateProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required').max(100, 'Product name too long').optional(),
  slug: commonSchemas.slug.optional(),
  description: z.string().max(1000, 'Description too long').nullable().optional(),
  isPublic: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const existing = await requireProductInProject(project.id, getRouterParam(event, 'productId'))
  const body = await validateBody(event, updateProductSchema)

  const slug =
    body.slug !== undefined && body.slug !== existing.slug
      ? await resolveProductSlug(project.id, { name: body.name ?? existing.name, slug: body.slug }, existing.id)
      : undefined

  const [updated] = await db
    .update(product)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(slug !== undefined && { slug }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.isPublic !== undefined && { isPublic: body.isPublic }),
      ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
      updatedAt: new Date(),
    })
    .where(eq(product.id, existing.id))
    .returning()

  return createSuccessResponse(toProductSummary(updated!))
})
