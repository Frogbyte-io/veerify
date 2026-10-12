/**
 * Shared (client + server) limits for feedback attachments. The server enforces
 * these authoritatively in `server/utils/feedback-attachments.ts`; the client
 * only uses them for early feedback in the picker.
 */
export const FEEDBACK_ATTACHMENT_MAX_COUNT = 5
export const FEEDBACK_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
export const FEEDBACK_ATTACHMENT_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.log,.json'
export const FEEDBACK_ATTACHMENT_ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'txt', 'log', 'json']

export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
