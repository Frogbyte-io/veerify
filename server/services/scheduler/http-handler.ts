import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { createLogger } from '~/server/utils/logger'
import { verifyCronSecret } from './cron-auth'
import { getScheduledTask } from './registry'

const logger = createLogger('scheduler')

/**
 * Build the event handler for a per-task Vercel Cron endpoint.
 *
 * `taskName` is baked in at the route level (one file per task, matching the
 * `vercel.json` `crons` entry) rather than read from a route param, so a
 * caller can never probe the registry for arbitrary task names.
 */
export function createCronHttpHandler(taskName: string) {
  return defineEventHandler(async (event) => {
    const authorized = verifyCronSecret(getHeader(event, 'authorization'), process.env.CRON_SECRET)
    if (!authorized) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
        data: createErrorResponse(ErrorCode.UNAUTHORIZED, 'Missing or invalid cron secret'),
      })
    }

    const task = getScheduledTask(taskName)
    if (!task) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        data: createErrorResponse(ErrorCode.NOT_FOUND, `Unknown scheduled task "${taskName}"`),
      })
    }

    try {
      const result = await task.handler()
      return createSuccessResponse({ task: taskName, result: result ?? null })
    } catch (error) {
      logger.error('Scheduled task failed', {
        task: taskName,
        error: error instanceof Error ? error.message : String(error),
      })
      throw createError({
        statusCode: 500,
        statusMessage: 'Internal Server Error',
        data: createErrorResponse(ErrorCode.INTERNAL_ERROR, `Scheduled task "${taskName}" failed`),
      })
    }
  })
}
