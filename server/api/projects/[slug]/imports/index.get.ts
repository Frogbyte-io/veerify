import { createSuccessResponse } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'
import { listImportRuns } from '~/server/services/imports/service'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectCategoryAccess(event)
  const runs = await listImportRuns(project.id)
  return createSuccessResponse(runs)
})
