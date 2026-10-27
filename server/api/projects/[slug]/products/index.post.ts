/**
 * @openapi
 * /api/projects/{slug}/products:
 *   post:
 *     tags: [Projects]
 *     summary: Create product
 *     description: >
 *       Creates a product (its own feedback board) in the project. Project admins only (organization owners and admins count as project admins). The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: createProjectProduct
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
 *               name: { type: string, minLength: 1, maxLength: 100 }
 *               slug: { type: string, minLength: 1, maxLength: 100, pattern: "^[a-z0-9-]+$", description: "Derived from name when omitted" }
 *               description: { type: string, maxLength: 1000, nullable: true }
 *               isPublic: { type: boolean, default: true }
 *     responses:
 *       201: { description: "Created product summary" }
 *       400: { description: "Validation failed or reserved slug" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not a project admin" }
 *       404: { description: "Project not found in the active workspace" }
 *       409: { description: "Slug already in use in the project" }
 */
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { sql, eq } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { product } from '~/server/database/schema/feedback'
import { resolveProductSlug } from '~/server/utils/product-rules'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { toProductSummary } from '~/server/utils/project-summary'
import { createSuccessResponse } from '~/server/utils/response'
import { commonSchemas, validateBody } from '~/server/utils/validation'

const createProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required').max(100, 'Product name too long'),
  slug: commonSchemas.slug.optional(),
  description: z.string().max(1000, 'Description too long').optional().nullable(),
  isPublic: z.boolean().optional().default(true),
})

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const body = await validateBody(event, createProductSchema)
  const slug = await resolveProductSlug(project.id, { name: body.name, slug: body.slug })

  const [{ next } = { next: 0 }] = await db
    .select({ next: sql<number>`coalesce(max(${product.sortOrder}) + 1, 0)::int` })
    .from(product)
    .where(eq(product.projectId, project.id))

  const now = new Date()
  const [created] = await db
    .insert(product)
    .values({
      id: randomUUID(),
      projectId: project.id,
      name: body.name,
      slug,
      description: body.description || null,
      isPublic: body.isPublic,
      sortOrder: next,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  setResponseStatus(event, 201)
  return createSuccessResponse(toProductSummary(created!))
})
