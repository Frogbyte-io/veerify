import { z } from 'zod'
import { requireAuth } from '~/server/utils/auth-middleware'
import { setActiveProjectForSession } from '~/server/utils/project-context'
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
    sessionToken: session.session.token,
    userId: session.user.id,
    projectId: body.projectId,
  })

  return createSuccessResponse(await buildActiveProjectContext(activeProject, session.user.id))
})
