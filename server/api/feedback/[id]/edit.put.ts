/**
 * @openapi
 * /api/feedback/{id}/edit:
 *   put:
 *     tags: [Feedback]
 *     summary: Edit feedback with a submitter edit token
 *     description: >
 *       Token-based; no session needed. Updates title and body when the edit token (from the confirmation email link, valid 7 days) matches.
 *     operationId: updateFeedbackWithEditToken
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Feedback id
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, title, body]
 *             properties:
 *               token: { type: string, minLength: 1, description: "Edit token from the confirmation email" }
 *               title: { type: string, minLength: 1, maxLength: 200 }
 *               body: { type: string, minLength: 1, maxLength: 5000 }
 *     responses:
 *       200: { description: "Updated id, title, body and updatedAt" }
 *       400: { description: "Validation failed" }
 *       403: { description: "Invalid or expired edit link" }
 *       404: { description: "Feedback not found" }
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { feedback } from '~/server/database/schema/feedback'

const editFeedbackSchema = z.object({
  token: z.string().min(1, 'Edit token is required'),
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  body: z.string().min(1, 'Description is required').max(5000, 'Description too long'),
})

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Feedback ID is required'),
    })
  }

  const body = await validateBody(event, editFeedbackSchema)

  const [item] = await db
    .select({
      id: feedback.id,
      metadata: feedback.metadata,
    })
    .from(feedback)
    .where(eq(feedback.id, id))
    .limit(1)

  if (!item) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Feedback not found'),
    })
  }

  if (!item.metadata?.editToken || item.metadata.editToken !== body.token) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'Invalid or expired edit link'),
    })
  }

  if (item.metadata.editTokenExpiry && new Date(item.metadata.editTokenExpiry) < new Date()) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: createErrorResponse(ErrorCode.FORBIDDEN, 'This edit link has expired'),
    })
  }

  const [updated] = await db
    .update(feedback)
    .set({
      title: body.title,
      body: body.body,
      updatedAt: new Date(),
    })
    .where(eq(feedback.id, id))
    .returning()

  return createSuccessResponse({
    id: updated.id,
    title: updated.title,
    body: updated.body,
    updatedAt: updated.updatedAt,
  })
})
