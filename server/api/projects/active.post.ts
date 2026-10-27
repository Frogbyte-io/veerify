/**
 * @openapi
 * /api/projects/active:
 *   post:
 *     tags: [Projects]
 *     summary: Set active project
 *     description: >
 *       Switches the active project (and its organization). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *       With a session cookie the active context is stored on the session; with a personal API key it is stored on the key itself. `X-Veerify-Organization` / `X-Veerify-Project` header context is never stored itself; the selection in the request body is what gets stored on the key.
 *     operationId: setActiveProject
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [projectId]
 *             properties:
 *               projectId: { type: string, minLength: 1 }
 *     responses:
 *       200: { description: "Active project context after the switch" }
 *       400: { description: "Validation failed" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "No access to the project" }
 *       404: { description: "Project not found" }
 */
import { z } from 'zod'
import { requireAuth } from '~/server/utils/auth-middleware'
import { contextTargetFor, setActiveProjectForSession } from '~/server/utils/project-context'
import { buildActiveProjectContext } from '~/server/utils/project-summary'
import { createSuccessResponse } from '~/server/utils/response'
import { validateBody } from '~/server/utils/validation'

const setActiveProjectSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await validateBody(event, setActiveProjectSchema)

  const activeProject = await setActiveProjectForSession({
    target: contextTargetFor(session),
    userId: session.user.id,
    projectId: body.projectId,
  })

  return createSuccessResponse(await buildActiveProjectContext(activeProject, session.user.id))
})
