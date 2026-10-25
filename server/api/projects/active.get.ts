import { requireAuthWithResolvedProject } from '~/server/utils/project-context'
import { buildActiveProjectContext } from '~/server/utils/project-summary'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { session, activeProject } = await requireAuthWithResolvedProject(event)
  return createSuccessResponse(await buildActiveProjectContext(activeProject, session.user.id))
})
