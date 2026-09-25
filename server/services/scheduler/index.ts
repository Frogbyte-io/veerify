import { createLogger } from '~/server/utils/logger'

export * from './types'
export { isValidCronExpression } from './cron'
export { verifyCronSecret } from './cron-auth'
export { createCronHttpHandler } from './http-handler'
export { clearScheduledTasks, defineScheduledTask, getScheduledTask, listScheduledTasks } from './registry'

const logger = createLogger('scheduler')

export type SchedulerBackend = 'vercel' | 'nitro'

/**
 * Which backend actually fires scheduled tasks on this deployment.
 *
 * Mirrors the deployment-mode detection in `nuxt.config.ts` exactly:
 * `APP_DEPLOYMENT_MODE` wins when set to a recognized value, otherwise infer
 * from Vercel's own env vars, otherwise assume self-hosted. Read directly
 * from `process.env` (not `useRuntimeConfig()`) so this resolves the same
 * way at module load, in a plain Node script, and inside a Nuxt request —
 * the same reasoning `server/services/realtime/index.ts` uses for
 * `REALTIME_DRIVER`.
 */
export function resolveSchedulerBackend(): SchedulerBackend {
  const configured = (process.env.APP_DEPLOYMENT_MODE || '').trim().toLowerCase()

  if (configured === 'cloud') return 'vercel'
  if (configured === 'self-hosted') return 'nitro'

  return process.env.VERCEL || process.env.VERCEL_ENV ? 'vercel' : 'nitro'
}

let loggedBackend: SchedulerBackend | null = null

/** Log the resolved backend once per process, mirroring the realtime driver's boot log. */
export function logSchedulerBackend(): SchedulerBackend {
  const backend = resolveSchedulerBackend()
  if (loggedBackend !== backend) {
    loggedBackend = backend
    logger.info(`Scheduler backend: ${backend === 'vercel' ? 'Vercel Cron' : 'Nitro scheduled tasks'}`)
  }
  return backend
}
