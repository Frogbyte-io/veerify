import { requireProjectBySlug } from '~/server/utils/project-categories'
import { listProjectMembers } from '~/server/utils/project-summary'
import { createSuccessResponse } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '')
  const members = await listProjectMembers(project)

  return createSuccessResponse({
    accessMode: project.accessMode === 'restricted' ? 'restricted' : 'workspace',
    members,
  })
})
