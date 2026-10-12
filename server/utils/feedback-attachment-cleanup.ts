import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { feedbackAttachment } from '~/server/database/schema/feedback'
import { getStorageProvider } from '~/server/utils/storage'
import type { StorageProvider } from '~/server/utils/storage/types'
import { FEEDBACK_ATTACHMENT_PENDING_TTL_MS, isMissingStorageObject } from '~/server/utils/feedback-attachments'

export const DEFAULT_FEEDBACK_ATTACHMENT_CLEANUP_BATCH = 50

export interface FeedbackAttachmentCleanupResult {
  claimed: number
  /** Pending / never-attached uploads older than the TTL. */
  expired: number
  /** Attachments whose feedback item was deleted. */
  orphaned: number
  retried: number
}

/**
 * Remove storage objects (and rows) for
 *  - uploads that were never attached to feedback within 24 h (`attached_at` is null), and
 *  - attachments whose feedback was deleted (`attached_at` set but `feedback_id` nulled by the FK).
 *
 * The object is deleted before the row so a provider failure leaves the row in
 * place for the next pass; a missing object counts as already deleted.
 */
export async function runFeedbackAttachmentCleanup(
  input: { now?: Date; maxBatch?: number; storage?: StorageProvider } = {}
): Promise<FeedbackAttachmentCleanupResult> {
  const now = input.now ?? new Date()
  const maxBatch = Math.max(1, Math.min(input.maxBatch ?? DEFAULT_FEEDBACK_ATTACHMENT_CLEANUP_BATCH, 200))
  const cutoff = new Date(now.getTime() - FEEDBACK_ATTACHMENT_PENDING_TTL_MS)

  const candidates = await db
    .select()
    .from(feedbackAttachment)
    .where(
      or(
        and(isNotNull(feedbackAttachment.attachedAt), isNull(feedbackAttachment.feedbackId)),
        and(isNull(feedbackAttachment.attachedAt), lt(feedbackAttachment.createdAt, cutoff))
      )
    )
    .limit(maxBatch)

  const result: FeedbackAttachmentCleanupResult = { claimed: candidates.length, expired: 0, orphaned: 0, retried: 0 }
  if (candidates.length === 0) return result

  const storage = input.storage ?? getStorageProvider()
  for (const row of candidates) {
    try {
      try {
        await storage.deleteObject(row.storageKey)
      } catch (error) {
        if (!isMissingStorageObject(error)) throw error
      }
      await db.delete(feedbackAttachment).where(eq(feedbackAttachment.id, row.id))
      if (row.attachedAt) result.orphaned++
      else result.expired++
    } catch {
      // Keep the row so the next pass retries. Provider errors can contain
      // storage keys or paths, so nothing from them is logged or returned.
      result.retried++
    }
  }
  return result
}
