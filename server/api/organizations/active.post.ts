import { z } from 'zod'
import { requireAuth } from '~/server/utils/auth-middleware'
import { createSuccessResponse } from '~/server/utils/response'
import { setActiveOrganizationForSession } from '~/server/utils/project-context'
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
    sessionToken: session.session.token,
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
