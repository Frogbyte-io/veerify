/**
 * @openapi
 * /api/projects/{slug}/statuses:
 *   post:
 *     tags: [Projects]
 *     summary: Create status
 *     description: >
 *       Creates a custom feedback status; its `value` is derived from the name. Project admins only (organization owners and admins count as project admins). The project is looked up by slug in the active workspace (override with the `X-Veerify-Organization` header when using an API key). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *     operationId: createProjectStatus
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         description: "Project slug"
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
 *               color: { type: string, pattern: "^#[0-9a-fA-F]{6}$", nullable: true, description: "Default #6b7280" }
 *               description: { type: string, maxLength: 200, nullable: true }
 *               sortOrder: { type: integer, minimum: 0, description: "Defaults to last" }
 *     responses:
 *       201: { description: "Created status" }
 *       400: { description: "Validation failed or invalid name" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not a project admin" }
 *       404: { description: "Project not found in the active workspace" }
 */
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
  const { project } = await requireProjectStatusAccess(event, { admin: true })
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
