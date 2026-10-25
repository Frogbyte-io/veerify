/**
 * @openapi
 * /api/projects/{slug}/api-keys:
 *   post:
 *     tags: [Projects]
 *     summary: Create an app key
 *     description: "The full key is returned once in this response and cannot be retrieved later."
 *     operationId: createProjectApiKey
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, minLength: 1, maxLength: 60 }
 *               productId: { type: string, description: "Product the key posts to; defaults to the project's first product" }
 *     responses:
 *       201: { description: "Key created; includes the full key once" }
 *       400: { description: "Validation failed" }
 *       403: { description: "Not a project admin" }
 *       404: { description: "Project or product not found" }
 */
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { projectApiKey } from '~/server/database/schema/feedback'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { requireProductInProject } from '~/server/utils/project-access'
import { generateAppKey } from '~/server/utils/app-keys'

const createKeySchema = z.object({
  name: z.string().trim().min(1).max(60),
  productId: z.string().min(1).optional(),
})

export default defineEventHandler(async (event) => {
  const { session, project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const body = await validateBody(event, createKeySchema)
  // Defaults to the project's first product; 404 when the product belongs to another project.
  const targetProduct = await requireProductInProject(project.id, body.productId)

  const { key, keyPrefix, keyHash } = generateAppKey()

  const [created] = await db
    .insert(projectApiKey)
    .values({
      id: crypto.randomUUID(),
      projectId: project.id,
      productId: targetProduct.id,
      name: body.name,
      keyPrefix,
      keyHash,
      createdByUserId: session.user.id,
      createdAt: new Date(),
    })
    .returning({
      id: projectApiKey.id,
      name: projectApiKey.name,
      keyPrefix: projectApiKey.keyPrefix,
      productId: projectApiKey.productId,
      createdAt: projectApiKey.createdAt,
      lastUsedAt: projectApiKey.lastUsedAt,
      revokedAt: projectApiKey.revokedAt,
    })

  setResponseStatus(event, 201)
  return createSuccessResponse({ ...created, productName: targetProduct.name, key })
})
