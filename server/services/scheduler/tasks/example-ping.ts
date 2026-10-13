/**
 * Trivial no-op task proving the scheduler mechanism wires up on both
 * backends. Not a real task — Stage 06 (SLA sweeper) and Stage 08 (CSAT
 * dispatch) are the first real consumers of `defineScheduledTask`.
 *
 * Imported by both backend adapters (`server/tasks/example/ping.ts` for
 * self-hosted, `server/api/cron/example-ping.get.ts` for Vercel) so
 * registration happens exactly once regardless of which backend is active.
 */
import { createLogger } from '~/server/utils/logger'
import { defineScheduledTask } from '../registry'

const logger = createLogger('scheduler')

export const EXAMPLE_PING_TASK_NAME = 'example:ping'

export const examplePingTask = defineScheduledTask(EXAMPLE_PING_TASK_NAME, '*/15 * * * *', async () => {
  const ranAt = new Date().toISOString()
  logger.info('Scheduled task "example:ping" ran (no-op)', { ranAt })
  return { ranAt }
})
