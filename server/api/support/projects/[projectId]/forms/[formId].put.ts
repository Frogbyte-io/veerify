/**
 * @openapi
 * /api/support/projects/{projectId}/forms/{formId}:
 *   put:
 *     tags: [Support]
 *     summary: Update a website form
 *     description: >
 *       Replaces the form definition (same body as create). Submissions already
 *       filed keep the fields they were submitted with; the public id never
 *       changes. Project admins only.
 *     operationId: updateSupportForm
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: formId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Form updated }
 *       400: { description: Validation failed }
 *       403: { description: Not a project admin }
 *       404: { description: Form not found }
 *       409: { description: Slug already used in this project }
 */
import { eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireProjectAdmin } from '~/server/utils/project-access'
import { validateBody } from '~/server/utils/validation'
import { db } from '~/server/database/drizzle'
import { supportForm } from '~/server/database/schema/support'
import { formDefinitionSchema } from '~/server/services/support-forms/definition'
import {
  requireFormInProject,
  requireInboxInProject,
  rethrowSlugConflict,
  serializeForm,
} from '~/server/services/support-forms/admin'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  const formId = getRouterParam(event, 'formId') as string
  await requireProjectAdmin(projectId, session.user.id)
  await requireFormInProject(projectId, formId)

  const body = await validateBody(event, formDefinitionSchema)
  await requireInboxInProject(projectId, body.inboxId)

  const [updated] = await db
    .update(supportForm)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(supportForm.id, formId))
    .returning()
    .catch(rethrowSlugConflict)

  return createSuccessResponse({ form: serializeForm(updated) })
})
