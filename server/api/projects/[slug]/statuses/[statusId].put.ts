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
  const { project } = await requireProjectStatusAccess(event)
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
