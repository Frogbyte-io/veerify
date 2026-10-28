import { importsAdvanceTask } from '~/server/services/scheduler/tasks/imports-advance'

export default defineTask({
  meta: {
    name: 'imports:advance',
    description: 'Advance committing import runs (apply staged records within a time budget).',
  },
  async run() {
    const result = await importsAdvanceTask.handler()
    return { result }
  },
})
