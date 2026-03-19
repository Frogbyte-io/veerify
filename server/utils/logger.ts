import { createConsola } from 'consola'

/**
 * Structured logger for server-side code.
 *
 * Usage:
 *   import { logger } from '~/server/utils/logger'
 *   logger.error('Failed to send email', { feedbackId, userId, error: err })
 *   logger.warn('Rate limit approaching', { ip, remaining: 2 })
 *   logger.info('Feedback created', { feedbackId, projectId })
 */
export const logger = createConsola({
  level: process.env.LOG_LEVEL ? Number(process.env.LOG_LEVEL) : undefined,
}).withTag('veerify')

/** Create a child logger scoped to a specific module */
export function createLogger(tag: string) {
  return logger.withTag(tag)
}
