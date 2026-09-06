import { runAttachmentCleanup } from '~/server/utils/support-attachment-cleanup'
import { defineScheduledTask } from '../registry'

export const ATTACHMENT_CLEANUP_TASK_NAME = 'support:attachment-cleanup'

export async function runScheduledAttachmentCleanup(deps: {
  runCleanup?: () => ReturnType<typeof runAttachmentCleanup>
} = {}) {
  try {
    return await (deps.runCleanup ?? runAttachmentCleanup)()
  } catch {
    // The scheduler's generic handler logs the thrown error. Keep provider,
    // database, and local path details out of that log boundary.
    throw new Error('ATTACHMENT_CLEANUP_FAILED')
  }
}

export const attachmentCleanupTask = defineScheduledTask(ATTACHMENT_CLEANUP_TASK_NAME, '*/5 * * * *', () =>
  runScheduledAttachmentCleanup()
)
