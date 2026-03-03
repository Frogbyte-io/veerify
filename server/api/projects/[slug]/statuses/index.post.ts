import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/server/database/drizzle'
import { feedbackStatus } from '~/server/database/schema/feedback'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'
import { requireProjectStatusAccess, toStatusValue } from '~/server/utils/project-statuses'

const createStatusSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .nullable(),
  description: z.string().trim().max(200).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
})

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectStatusAccess(event)
  const body = await validateBody(event, createStatusSchema)

  const baseValue = toStatusValue(body.name)
  if (!baseValue) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Status name is invalid'),
    })
  }

  const existingStatuses = await db
    .select({ value: feedbackStatus.value })
    .from(feedbackStatus)
    .where(eq(feedbackStatus.projectId, project.id))

  let value = baseValue
  const existing = new Set(existingStatuses.map((s) => s.value))
  let suffix = 2
  while (existing.has(value)) {
    value = `${baseValue}_${suffix++}`
  }

  const [lastStatus] = await db
    .select({ sortOrder: feedbackStatus.sortOrder })
    .from(feedbackStatus)
    .where(eq(feedbackStatus.projectId, project.id))
    .orderBy(desc(feedbackStatus.sortOrder))
    .limit(1)

  const nextOrder = body.sortOrder ?? (lastStatus?.sortOrder ?? -1) + 1

  const [created] = await db
    .insert(feedbackStatus)
    .values({
      id: crypto.randomUUID(),
      projectId: project.id,
      name: body.name,
      value,
      color: body.color || '#6b7280',
      description: body.description || null,
      sortOrder: nextOrder,
      isDefault: false,
      createdAt: new Date(),
    })
    .returning()

  setResponseStatus(event, 201)
  return createSuccessResponse(created)
})
