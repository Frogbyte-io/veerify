/**
 * @openapi
 * /api/projects/{slug}/statuses/{statusId}:
 *   delete:
 *     tags: [Projects]
 *     summary: Delete status
 *     description: >
 *       Deletes a non-default status. When feedback uses it, `replacementValue` (the `value` of another status of the project) is required and that feedback is moved there first. Project admins only (organization owners and admins count as project admins). The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: deleteProjectStatus
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
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               replacementValue: { type: string, minLength: 1, nullable: true, description: "Status value (not id) of the replacement; required when feedback uses the status" }
 *     responses:
 *       200: { description: "{ id, deleted: true }" }
 *       400: { description: "Invalid replacement status" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Not a project admin, or the status is a default status" }
 *       404: { description: "Project or status not found" }
 *       409: { description: "Status in use and no replacementValue given" }
 */
import { and, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { feedback, feedbackStatus } from '~/server/database/schema/feedback'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { requireProjectStatusAccess } from '~/server/utils/project-statuses'

const deleteStatusSchema = z.object({
  replacementValue: z.string().min(1).optional().nullable(),
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

  const rawBody = (await readBody(event).catch(() => ({}))) ?? {}
  const parsedBody = deleteStatusSchema.safeParse(rawBody)
  if (!parsedBody.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Validation failed',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Request validation failed', parsedBody.error.issues),
    })
  }
  const body = parsedBody.data

  const [status] = await db
    .select()
    .from(feedbackStatus)
    .where(and(eq(feedbackStatus.id, statusId), eq(feedbackStatus.projectId, project.id)))
    .limit(1)

  if (!status) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Status not found'),
    })
  }

  if (status.isDefault) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'Default statuses cannot be deleted'),
    })
  }

  const [usage] = await db
    .select({ count: count() })
    .from(feedback)
    .where(and(eq(feedback.projectId, project.id), eq(feedback.status, status.value)))

  const usageCount = usage?.count ?? 0
  if (usageCount > 0 && !body.replacementValue) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: createErrorResponse(
        ErrorCode.CONFLICT,
        'Status is used by feedback items. Provide replacementValue before deletion.'
      ),
    })
  }

  if (usageCount > 0 && body.replacementValue) {
    // Verify replacement exists in this project's statuses
    const [replacement] = await db
      .select()
      .from(feedbackStatus)
      .where(and(eq(feedbackStatus.value, body.replacementValue), eq(feedbackStatus.projectId, project.id)))
      .limit(1)

    if (!replacement || replacement.id === status.id) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Replacement status is invalid'),
      })
    }

    await db
      .update(feedback)
      .set({ status: replacement.value })
      .where(and(eq(feedback.projectId, project.id), eq(feedback.status, status.value)))
  }

  await db.delete(feedbackStatus).where(and(eq(feedbackStatus.id, status.id), eq(feedbackStatus.projectId, project.id)))

  return createSuccessResponse({ id: status.id, deleted: true })
})
