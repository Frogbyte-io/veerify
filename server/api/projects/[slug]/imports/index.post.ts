/**
 * @openapi
 * /api/projects/{slug}/imports:
 *   post:
 *     tags: [Imports]
 *     summary: Create an import run
 *     description: "Creates a draft run. Add records in batches, then preview and commit."
 *     operationId: createImportRun
 *     security: [{ cookieAuth: [] }, { userApiKeyAuth: [] }]
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
 *             required: [source, sourceLabel]
 *             properties:
 *               source: { type: string, minLength: 1, maxLength: 60, pattern: "^[a-z0-9_-]+$" }
 *               sourceLabel: { type: string, minLength: 1, maxLength: 60 }
 *               product: { type: string, description: "Product slug or id; defaults to the project's first product" }
 *               onExisting: { type: string, enum: [sync, skip], default: sync }
 *     responses:
 *       201: { description: "Run created" }
 *       400: { description: "Validation failed" }
 *       403: { description: "Not a project admin" }
 *       404: { description: "Project or product not found" }
 */
import { z } from 'zod'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireProjectBySlug } from '~/server/utils/project-categories'
import { createImportRun, resolveImportProduct } from '~/server/services/imports/runs'

const createRunSchema = z.object({
  source: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9_-]+$/),
  sourceLabel: z.string().trim().min(1).max(60),
  product: z.string().min(1).optional(),
  onExisting: z.enum(['sync', 'skip']).optional(),
})

export default defineEventHandler(async (event) => {
  const { session, project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const body = await validateBody(event, createRunSchema)
  const target = await resolveImportProduct(project.id, body.product)

  const run = await createImportRun({
    projectId: project.id,
    productId: target.id,
    userId: session.user.id,
    source: body.source,
    sourceLabel: body.sourceLabel,
    onExisting: body.onExisting,
  })

  setResponseStatus(event, 201)
  return createSuccessResponse(run)
})
