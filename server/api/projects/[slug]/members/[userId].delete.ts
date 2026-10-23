import { requireProjectBySlug } from '~/server/utils/project-categories'
import { deleteProjectMember, requireAssignableUser } from '~/server/utils/project-members'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectBySlug(event, getRouterParam(event, 'slug') ?? '', { admin: true })
  const userId = getRouterParam(event, 'userId') ?? ''

  await requireAssignableUser(project, userId)
  const removed = await deleteProjectMember(project.id, userId)
  if (!removed) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'This person has no explicit project membership to remove'),
    })
  }

  return createSuccessResponse({ userId, removed: true })
})
