/**
 * @openapi
 * /api/organizations/active:
 *   post:
 *     tags: [Organizations]
 *     summary: Set active organization
 *     description: >
 *       Switches the active organization (workspace) and, in the same step, the active project inside it: `projectId` is honoured when the caller can open it, otherwise the first accessible project is used (null when there is none). Requires authentication: a session cookie or a personal API key (`Authorization: Bearer vfy_usr_...`).
 *       With a session cookie the active context is stored on the session; with a personal API key it is stored on the key itself. Requests that override the context with `X-Veerify-Organization` or `X-Veerify-Project` headers never persist it.
 *     operationId: setActiveOrganization
 *     security:
 *       - cookieAuth: []
 *       - userApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [organizationId]
 *             properties:
 *               organizationId: { type: string, minLength: 1 }
 *               projectId: { type: string, minLength: 1, nullable: true, description: "Last-used project hint; ignored unless the caller can open it in that organization" }
 *     responses:
 *       200: { description: "{ organization: { id, name, slug, logo } | null, project: project summary | null }" }
 *       400: { description: "Validation failed" }
 *       401: { description: "Not authenticated" }
 *       403: { description: "Caller is not a member of the organization" }
 */
import { z } from 'zod'
import { requireAuth } from '~/server/utils/auth-middleware'
import { createSuccessResponse } from '~/server/utils/response'
import { contextTargetFor, setActiveOrganizationForSession } from '~/server/utils/project-context'
import { toProjectSummary } from '~/server/utils/project-summary'
import { db } from '~/server/database/drizzle'
import { organization } from '~/server/database/schema/auth'
import { eq } from 'drizzle-orm'
import { validateBody } from '~/server/utils/validation'

const setActiveOrganizationSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  // Last-used project hint; ignored unless it is a project the user can open in that organization.
  projectId: z.string().min(1).nullish(),
})

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const body = await validateBody(event, setActiveOrganizationSchema)

  const activeProject = await setActiveOrganizationForSession({
    target: contextTargetFor(session),
    userId: session.user.id,
    organizationId: body.organizationId,
    preferredProjectId: body.projectId ?? null,
  })

  const [org] = await db.select().from(organization).where(eq(organization.id, body.organizationId)).limit(1)

  return createSuccessResponse({
    organization: org ? { id: org.id, name: org.name, slug: org.slug, logo: org.logo } : null,
    project: activeProject ? toProjectSummary(activeProject) : null,
  })
})
