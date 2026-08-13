import { z } from 'zod'
import { analyzeImportForProject, getImportRunDetail } from '~/server/services/imports/service'
import { createSuccessResponse } from '~/server/utils/response'
import { requireProjectCategoryAccess } from '~/server/utils/project-categories'
import { validateBody } from '~/server/utils/validation'

const analyzeImportSchema = z.object({
  sourceType: z.enum(['sleekplan', 'csv']),
  sourceMode: z.enum(['api', 'file']).optional(),
  csvContent: z.string().max(5_000_000).optional(),
  csvFilename: z.string().max(255).nullable().optional(),
  csvFiles: z
    .array(
      z.object({
        content: z.string().max(5_000_000),
        filename: z.string().max(255).nullable().optional(),
      })
    )
    .max(10)
    .optional(),
  sleekplan: z
    .object({
      baseUrl: z.string().url(),
      apiKey: z.string().min(1).max(1000),
    })
    .optional(),
  contentScope: z
    .object({
      feedback: z.boolean().optional(),
      roadmap: z.boolean().optional(),
      changelog: z.boolean().optional(),
      comments: z.boolean().optional(),
      subscriptions: z.boolean().optional(),
    })
    .optional(),
})

export default defineEventHandler(async (event) => {
  const { project, session } = await requireProjectCategoryAccess(event)
  const body = await validateBody(event, analyzeImportSchema)

  const result = await analyzeImportForProject({
    projectId: project.id,
    createdByUserId: session.user.id,
    input: body,
  })

  const run = await getImportRunDetail(project.id, result.runId)
  return createSuccessResponse(run)
})
