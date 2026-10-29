import { trashPurgeTask } from '~/server/services/scheduler/tasks/trash-purge'

export default defineTask({
  meta: {
    name: 'support:trash-purge',
    description: 'Permanently delete inbox conversations that have been in Trash for 30 days.',
  },
  async run() {
    const result = await trashPurgeTask.handler()
    return { result }
  },
})
