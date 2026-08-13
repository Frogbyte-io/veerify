import { z } from 'zod'
import { createSuccessResponse, createErrorResponse, ErrorCode } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'
import { startImportRun } from '~/server/services/imports/service'
import { validateBody } from '~/server/utils/validation'

const startImportSchema = z.object({
  mappingConfig: z.any(),
})

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

  const body = await validateBody(event, startImportSchema)
  const run = await startImportRun({
    projectRecord: project,
    runId,
    mappingConfig: body.mappingConfig,
  })

  return createSuccessResponse(run)
})
