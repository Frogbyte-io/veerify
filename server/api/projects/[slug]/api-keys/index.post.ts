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
 *     responses:
 *       201: { description: "Key created; includes the full key once" }
 *       400: { description: "Validation failed" }
 *       403: { description: "Not a team member" }
 *       404: { description: "Project not found" }
 */
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { projectApiKey } from '~/server/database/schema/feedback'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'
import { generateAppKey } from '~/server/utils/app-keys'

const createKeySchema = z.object({
  name: z.string().trim().min(1).max(60),
})

export default defineEventHandler(async (event) => {
  const { session, project } = await requireProjectCategoryAccess(event)
  const body = await validateBody(event, createKeySchema)

  const { key, keyPrefix, keyHash } = generateAppKey()

  const [created] = await db
    .insert(projectApiKey)
    .values({
      id: crypto.randomUUID(),
      projectId: project.id,
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
      createdAt: projectApiKey.createdAt,
      lastUsedAt: projectApiKey.lastUsedAt,
      revokedAt: projectApiKey.revokedAt,
    })

  setResponseStatus(event, 201)
  return createSuccessResponse({ ...created, key })
})
