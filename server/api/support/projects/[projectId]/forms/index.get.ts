/**
 * @openapi
 * /api/support/projects/{projectId}/forms:
 *   get:
 *     tags: [Support]
 *     summary: List website forms
 *     description: The project's website forms, each with its submission count. Project admins only.
 *     operationId: listSupportForms
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Forms }
 *       403: { description: Not a project admin }
 */
import { asc, count, eq, max } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireProjectAdmin } from '~/server/utils/project-access'
import { db } from '~/server/database/drizzle'
import { supportForm, supportFormSubmission } from '~/server/database/schema/support'
import { serializeForm } from '~/server/services/support-forms/admin'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  await requireProjectAdmin(projectId, session.user.id)

  const rows = await db
    .select()
    .from(supportForm)
    .where(eq(supportForm.projectId, projectId))
    .orderBy(asc(supportForm.name), asc(supportForm.id))

  const stats = await db
    .select({
      formId: supportFormSubmission.formId,
      submissions: count(),
      lastSubmittedAt: max(supportFormSubmission.createdAt),
    })
    .from(supportFormSubmission)
    .where(eq(supportFormSubmission.projectId, projectId))
    .groupBy(supportFormSubmission.formId)
  const byForm = new Map(stats.map((row) => [row.formId, row]))

  return createSuccessResponse({
    forms: rows.map((row) => ({
      ...serializeForm(row),
      submissionCount: byForm.get(row.id)?.submissions ?? 0,
      lastSubmittedAt: byForm.get(row.id)?.lastSubmittedAt ?? null,
    })),
  })
})
