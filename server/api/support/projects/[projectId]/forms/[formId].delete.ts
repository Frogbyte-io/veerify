/**
 * @openapi
 * /api/support/projects/{projectId}/forms/{formId}:
 *   delete:
 *     tags: [Support]
 *     summary: Delete a website form
 *     description: >
 *       Further submissions to it are refused (404). Conversations it already
 *       created stay in the inbox. Project admins only.
 *     operationId: deleteSupportForm
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
 *       200: { description: Form deleted }
 *       403: { description: Not a project admin }
 *       404: { description: Form not found }
 */
import { eq } from 'drizzle-orm'
import { createSuccessResponse } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireProjectAdmin } from '~/server/utils/project-access'
import { db } from '~/server/database/drizzle'
import { supportForm } from '~/server/database/schema/support'
import { requireFormInProject } from '~/server/services/support-forms/admin'

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const projectId = getRouterParam(event, 'projectId') as string
  const formId = getRouterParam(event, 'formId') as string
  await requireProjectAdmin(projectId, session.user.id)
  await requireFormInProject(projectId, formId)

  await db.delete(supportForm).where(eq(supportForm.id, formId))
  return createSuccessResponse({ deleted: true })
})
