/**
 * @openapi
 * /api/projects/{slug}/statuses/{statusId}:
 *   put:
 *     tags: [Projects]
 *     summary: Update status
 *     description: >
 *       Updates a status's name, color, description or order; its `value` never changes. Project admins only (organization owners and admins count as project admins). The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: updateProjectStatus
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
 *         name: statusId
 *         required: true
 *         description: "Status id"
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, minLength: 1, maxLength: 80 }
 *               color: { type: string, pattern: "^#[0-9a-fA-F]{6}$", nullable: true }
 *               description: { type: string, maxLength: 200, nullable: true }
 *               sortOrder: { type: integer, minimum: 0 }
 *     responses:
 *       200: { description: "Updated status" }
 *       400: { description: "Validation failed" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not a project admin" }
 *       404: { description: "Project or status not found" }
 */
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { feedbackStatus } from '~/server/database/schema/feedback'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireProjectStatusAccess } from '~/server/utils/project-statuses'

const updateStatusSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
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
  const { project } = await requireProjectStatusAccess(event, { admin: true })
  const statusId = getRouterParam(event, 'statusId')
  if (!statusId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Status ID is required'),
    })
  }

  const body = await validateBody(event, updateStatusSchema)

  const [current] = await db
    .select()
    .from(feedbackStatus)
    .where(and(eq(feedbackStatus.id, statusId), eq(feedbackStatus.projectId, project.id)))
    .limit(1)

  if (!current) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Status not found'),
    })
  }

  const [updated] = await db
    .update(feedbackStatus)
    .set({
      name: body.name ?? current.name,
      color: body.color === undefined ? current.color : body.color,
      description: body.description === undefined ? current.description : body.description,
      sortOrder: body.sortOrder ?? current.sortOrder,
    })
    .where(and(eq(feedbackStatus.id, statusId), eq(feedbackStatus.projectId, project.id)))
    .returning()

  return createSuccessResponse(updated)
})
