import { runAttachmentCleanup } from '~/server/utils/support-attachment-cleanup'
import { runFeedbackAttachmentCleanup } from '~/server/utils/feedback-attachment-cleanup'
import { defineScheduledTask } from '../registry'

export const ATTACHMENT_CLEANUP_TASK_NAME = 'support:attachment-cleanup'

/**
 * One scheduled pass reclaims both support upload sessions and feedback
 * attachments (stale uploads, attachments of deleted feedback). The two run
 * independently so a failure in one never starves the other.
 */
export async function runScheduledAttachmentCleanup(
  deps: {
    runCleanup?: () => ReturnType<typeof runAttachmentCleanup>
    runFeedbackCleanup?: () => ReturnType<typeof runFeedbackAttachmentCleanup>
  } = {}
) {
  const [support, feedback] = await Promise.allSettled([
    (deps.runCleanup ?? runAttachmentCleanup)(),
    (deps.runFeedbackCleanup ?? runFeedbackAttachmentCleanup)(),
  ])
  if (support.status === 'rejected' || feedback.status === 'rejected') {
    // The scheduler's generic handler logs the thrown error. Keep provider,
    // database, and local path details out of that log boundary.
    throw new Error('ATTACHMENT_CLEANUP_FAILED')
  }
  return { ...support.value, feedback: feedback.value }
}

export const attachmentCleanupTask = defineScheduledTask(ATTACHMENT_CLEANUP_TASK_NAME, '*/5 * * * *', () =>
  runScheduledAttachmentCleanup()
)
