import { attachmentCleanupTask } from '~/server/services/scheduler/tasks/attachment-cleanup'

export default defineTask({
  meta: {
    name: 'support:attachment-cleanup',
    description: 'Recover abandoned support attachment uploads and delete orphaned objects.',
  },
  async run() {
    const result = await attachmentCleanupTask.handler()
    return { result }
  },
})
