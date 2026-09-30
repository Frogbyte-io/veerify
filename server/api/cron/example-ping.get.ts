/**
 * Cloud (Vercel Cron) side of the trivial `example:ping` scheduled task.
 *
 * Matched by the `vercel.json` `crons` entry for this path. Vercel triggers
 * cron jobs with an HTTP GET request carrying `Authorization: Bearer
 * <CRON_SECRET>` — `createCronHttpHandler` rejects anything else with 401
 * before touching the registry, using a timing-safe comparison (see
 * `cron-auth.ts`).
 *
 * @openapi
 * /api/cron/example-ping:
 *   get:
 *     tags: [Internal]
 *     summary: Scheduled task trigger (Vercel Cron only)
 *     description: >
 *       Invoked by Vercel Cron on the schedule declared in vercel.json.
 *       Requires a bearer CRON_SECRET; not intended for manual calls.
 *     operationId: cronExamplePing
 *     responses:
 *       200:
 *         description: Task executed
 *       401:
 *         description: Missing or invalid cron secret
 */
import { createCronHttpHandler } from '~/server/services/scheduler'
import { EXAMPLE_PING_TASK_NAME } from '~/server/services/scheduler/tasks/example-ping'

export default createCronHttpHandler(EXAMPLE_PING_TASK_NAME)
