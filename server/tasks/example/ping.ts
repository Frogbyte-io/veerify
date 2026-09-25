/**
 * Self-hosted (Nitro) side of the trivial `example:ping` scheduled task.
 *
 * Nitro derives the task name from this file's path under `server/tasks/`
 * (slashes become colons), so this file must live at exactly this path to
 * match `EXAMPLE_PING_TASK_NAME` ("example:ping") and the `nitro.scheduledTasks`
 * entry in `nuxt.config.ts`. `defineTask` is auto-imported by Nitro.
 *
 * This is wiring, not business logic — the actual behavior lives in the
 * shared registration at `server/services/scheduler/tasks/example-ping.ts`,
 * which the Vercel Cron endpoint (`server/api/cron/example-ping.get.ts`)
 * reuses so both backends run identical logic.
 */
import { examplePingTask } from '~/server/services/scheduler/tasks/example-ping'

export default defineTask({
  meta: {
    name: 'example:ping',
    description: 'No-op task proving the self-hosted scheduler backend wires up (Stage 00).',
  },
  async run() {
    const result = await examplePingTask.handler()
    return { result }
  },
})
