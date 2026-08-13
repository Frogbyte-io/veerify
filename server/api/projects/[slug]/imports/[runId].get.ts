import { createSuccessResponse, createErrorResponse, ErrorCode } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'
import { getImportRunDetail } from '~/server/services/imports/service'

export default defineEventHandler(async (event) => {
  const { project } = await requireProjectCategoryAccess(event)
  const runId = getRouterParam(event, 'runId')
  if (!runId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Run ID is required'),
    })
  }

  const run = await getImportRunDetail(project.id, runId)
  return createSuccessResponse(run)
})
