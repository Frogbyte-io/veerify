/**
 * @openapi
 * /api/projects/{slug}/api-keys:
 *   post:
 *     tags: [Projects]
 *     summary: Create an app key or a server key
 *     description: "The full key is returned once in this response and cannot be retrieved later. App keys (`vfy_pub_`) post feedback to a product from apps. Server keys (`vfy_srv_`) are secrets for a website's backend to submit forms; they have no product."
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
 *               kind: { type: string, enum: [app, server], default: app, description: "app (vfy_pub_, posts feedback to a product) or server (vfy_srv_, submits website forms)" }
 *               productId: { type: string, description: "App keys only. Product the key posts to; defaults to the project's first product. Refused for server keys." }
 *     responses:
 *       201: { description: "Key created; includes the full key once" }
 *       400: { description: "Validation failed" }
 *       403: { description: "Not a project admin" }
 *       404: { description: "Project or product not found" }
 */
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { projectApiKey } from '~/server/database/schema/feedback'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { requireProductInProject } from '~/server/utils/project-access'
import { generateAppKey } from '~/server/utils/app-keys'

const createKeySchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(['app', 'server']).default('app'),
  productId: z.string().min(1).optional(),
})

export default defineEventHandler(async (event) => {
  const { session, project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const body = await validateBody(event, createKeySchema)
  if (body.kind === 'server' && body.productId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Validation failed',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Server keys are not tied to a product'),
    })
  }
  // App keys default to the project's first product; 404 when the product belongs to another project.
  const targetProduct = body.kind === 'app' ? await requireProductInProject(project.id, body.productId) : null

  const { key, keyPrefix, keyHash } = generateAppKey(body.kind)

  const [created] = await db
    .insert(projectApiKey)
    .values({
      id: crypto.randomUUID(),
      projectId: project.id,
      kind: body.kind,
      productId: targetProduct?.id ?? null,
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
      kind: projectApiKey.kind,
      productId: projectApiKey.productId,
      createdAt: projectApiKey.createdAt,
      lastUsedAt: projectApiKey.lastUsedAt,
      revokedAt: projectApiKey.revokedAt,
    })

  setResponseStatus(event, 201)
  return createSuccessResponse({ ...created, productName: targetProduct?.name ?? null, key })
})
