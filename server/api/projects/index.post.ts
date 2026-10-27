/**
 * @openapi
 * /api/projects:
 *   post:
 *     tags: [Projects]
 *     summary: Create project
 *     description: >
 *       Creates a project in the active organization together with its default product (same name and slug) and default categories. Organization owners and admins only. Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: createProject
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
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
 *       201: { description: "{ project: project summary, product: product summary }" }
 *       400: { description: "Validation failed or reserved slug" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not an organization owner or admin" }
 *       409: { description: "Slug already in use or no active organization" }
 */
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { db } from '~/server/database/drizzle'
import { feedbackCategory, product, project } from '~/server/database/schema/feedback'
import { requireOrganizationAdmin } from '~/server/utils/project-access'
import { requireAuthWithOrganization } from '~/server/utils/project-context'
import { RESERVED_PRODUCT_SLUGS, resolveProjectSlug } from '~/server/utils/product-rules'
import { toProductSummary, toProjectSummary } from '~/server/utils/project-summary'
import { createSuccessResponse } from '~/server/utils/response'
import { commonSchemas, validateBody } from '~/server/utils/validation'

const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required').max(100, 'Project name too long'),
  slug: commonSchemas.slug.optional(),
  description: z.string().max(1000, 'Description too long').optional().nullable(),
  isPublic: z.boolean().optional().default(true),
})

const DEFAULT_CATEGORIES = [
  { name: 'Bug', slug: 'bug', icon: '🐛', color: '#ef4444', description: 'Something isn’t working' },
  { name: 'Feature', slug: 'feature', icon: '✨', color: '#10b981', description: 'A new capability or improvement' },
]

export default defineEventHandler(async (event) => {
  const { session, organizationId } = await requireAuthWithOrganization(event)
  await requireOrganizationAdmin(organizationId, session.user.id)

  const body = await validateBody(event, createProjectSchema)
  const slug = await resolveProjectSlug(organizationId, { name: body.name, slug: body.slug })

  const now = new Date()
  const projectId = randomUUID()
  const productId = randomUUID()
  // The default product shares the project's name and slug, so a single-product project is just "the project".
  // Product slugs have extra reserved words (public sub-pages), so a clashing slug gets a suffix.
  const productSlug = RESERVED_PRODUCT_SLUGS.has(slug) ? `${slug}-product` : slug

  const { createdProject, createdProduct } = await db.transaction(async (tx) => {
    const [newProject] = await tx
      .insert(project)
      .values({
        id: projectId,
        organizationId,
        slug,
        name: body.name,
        description: body.description || null,
        isPublic: body.isPublic,
        accessMode: 'workspace',
        settings: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    const [newProduct] = await tx
      .insert(product)
      .values({
        id: productId,
        projectId,
        name: body.name,
        slug: productSlug,
        description: body.description || null,
        isPublic: true,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    await tx.insert(feedbackCategory).values(
      DEFAULT_CATEGORIES.map((category, index) => ({
        id: randomUUID(),
        projectId,
        name: category.name,
        slug: category.slug,
        icon: category.icon,
        color: category.color,
        description: category.description,
        isDefault: true,
        sortOrder: index,
        createdAt: now,
      }))
    )

    return { createdProject: newProject!, createdProduct: newProduct! }
  })

  setResponseStatus(event, 201)
  return createSuccessResponse({
    project: toProjectSummary({ ...createdProject, role: 'admin' }),
    product: toProductSummary(createdProduct),
  })
})
