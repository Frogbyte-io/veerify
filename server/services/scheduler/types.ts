/**
 * Scheduler abstraction contract.
 *
 * One registration surface (`defineScheduledTask`) backs two execution paths:
 *
 * - In-process: Nitro's `experimental.tasks` scheduler runs the handler on a
 *   cron tick via `server/tasks/**` files.
 * - HTTP: an external scheduler may invoke `/api/cron/*` per task with the
 *   `CRON_SECRET` bearer token; the app authenticates and runs the handler.
 *
 * Neither path supports registering a task purely at runtime — Nitro
 * discovers tasks from the filesystem at build time, and the HTTP endpoints
 * are static routes. `defineScheduledTask` centralizes the
 * handler, name uniqueness, and cron validation; a small per-task adapter
 * file still wires it into each backend (see `server/tasks/example/ping.ts`
 * and `server/api/cron/example-ping.get.ts`).
 */

export type ScheduledTaskHandler = () => Promise<unknown> | unknown

export interface ScheduledTaskDefinition {
  /** Unique task name, e.g. `example:ping`. Colon-namespaced by convention. */
  name: string
  /** Standard 5-field cron expression (minute hour day-of-month month day-of-week). */
  cron: string
  handler: ScheduledTaskHandler
}
