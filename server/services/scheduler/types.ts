/**
 * Scheduler abstraction contract.
 *
 * One registration surface (`defineScheduledTask`) backs two very different
 * execution models:
 *
 * - Cloud (Vercel): a static `vercel.json` `crons` entry invokes an HTTP
 *   endpoint per task. Vercel's platform is the actual scheduler; the app
 *   just authenticates and runs the handler when asked.
 * - Self-hosted: Nitro's `experimental.tasks` scheduler runs the handler
 *   in-process on a cron tick via `server/tasks/**` files.
 *
 * Neither backend supports registering a task purely at runtime — Nitro
 * discovers tasks from the filesystem at build time, and Vercel Cron needs a
 * static route in `vercel.json`. `defineScheduledTask` centralizes the
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
