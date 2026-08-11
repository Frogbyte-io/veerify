import { isValidCronExpression } from './cron'
import type { ScheduledTaskDefinition, ScheduledTaskHandler } from './types'

const registry = new Map<string, ScheduledTaskDefinition>()

/**
 * Register a scheduled task.
 *
 * This is the single call site future stages use (Stage 03's IMAP poll,
 * Stage 06's SLA sweeper). Registration only stores the definition in a
 * process-wide map — actually running it on a schedule is the job of the
 * backend-specific adapter (`server/tasks/**` for self-hosted,
 * `server/api/cron/*.get.ts` for Vercel), both of which look the
 * definition up by name via `getScheduledTask`.
 *
 * Throws synchronously on an invalid name, an invalid cron expression, or a
 * duplicate name — these are programmer errors caught at module load, not
 * runtime conditions to degrade gracefully from.
 */
export function defineScheduledTask(
  name: string,
  cron: string,
  handler: ScheduledTaskHandler
): ScheduledTaskDefinition {
  const trimmedName = typeof name === 'string' ? name.trim() : ''
  if (!trimmedName) {
    throw new Error('defineScheduledTask: `name` is required')
  }

  if (!isValidCronExpression(cron)) {
    throw new Error(`defineScheduledTask: "${cron}" is not a valid 5-field cron expression`)
  }

  if (typeof handler !== 'function') {
    throw new Error('defineScheduledTask: `handler` must be a function')
  }

  if (registry.has(trimmedName)) {
    throw new Error(`defineScheduledTask: a task named "${trimmedName}" is already registered`)
  }

  const definition: ScheduledTaskDefinition = { name: trimmedName, cron: cron.trim(), handler }
  registry.set(trimmedName, definition)
  return definition
}

export function getScheduledTask(name: string): ScheduledTaskDefinition | undefined {
  return registry.get(name)
}

export function listScheduledTasks(): ScheduledTaskDefinition[] {
  return Array.from(registry.values())
}

/** Test seam: clear the registry between tests so names can be reused. */
export function clearScheduledTasks(): void {
  registry.clear()
}
