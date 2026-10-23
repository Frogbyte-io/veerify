/**
 * @openapi
 * /api/marketing/projects/{projectId}/launch-kit/custom:
 *   post:
 *     tags: [Marketing]
 *     summary: Add a custom directory to the launch kit
 *     description: At most 30 custom directories per product.
 *     operationId: createMarketingLaunchKitCustom
 *     parameters:
 *       - in: path
 *         name: projectId
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
 *               name: { type: string, minLength: 1, maxLength: 80 }
 *               url: { type: string, nullable: true, maxLength: 500, description: https URL }
 *     responses:
 *       200: { description: Custom directory created }
 *       400: { description: Validation failed or the 30 directory limit is reached }
 *       403: { description: No access to this project, or Marketing is off }
 *       404: { description: Product not found }
 */
import { randomUUID } from 'node:crypto'
import { and, count, eq, like } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { launchKitItem } from '~/server/database/schema/marketing'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireMarketingAccess } from '~/server/utils/marketing-access'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireRouteParam } from '~/server/utils/marketing-site'
import {
  createCustomSchema,
  CUSTOM_PREFIX,
  MAX_CUSTOM_DIRECTORIES,
  serializeCustomItem,
} from '~/server/utils/marketing-launch-kit'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = requireRouteParam(event, 'projectId')
  await requireMarketingAccess(projectId, session.user.id)
  const body = await validateBody(event, createCustomSchema)

  const [{ total }] = await db
    .select({ total: count() })
    .from(launchKitItem)
    .where(and(eq(launchKitItem.projectId, projectId), like(launchKitItem.directoryId, `${CUSTOM_PREFIX}%`)))
  if (total >= MAX_CUSTOM_DIRECTORIES) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(
        ErrorCode.VALIDATION_ERROR,
        `A product can have at most ${MAX_CUSTOM_DIRECTORIES} custom directories`
      ),
    })
  }

  const now = new Date()
  const [row] = await db
    .insert(launchKitItem)
    .values({
      id: randomUUID(),
      projectId,
      directoryId: `${CUSTOM_PREFIX}${randomUUID()}`,
      name: body.name,
      url: body.url ?? null,
      status: 'todo',
      updatedByUserId: session.user.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  return createSuccessResponse({ item: serializeCustomItem(row) })
})
