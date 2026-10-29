import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import {
  conversation,
  conversationAttachment,
  conversationMessage,
  supportAttachmentUpload,
} from '~/server/database/schema/support'
import { getStorageProvider } from '~/server/utils/storage'
import type { StorageProvider } from '~/server/utils/storage/types'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Conversations stay in Trash this long before the purge job deletes them. */
export const TRASH_RETENTION_DAYS = 30
export const DEFAULT_TRASH_PURGE_BATCH = 25

export const CONVERSATION_LIST_VIEWS = [
  'unassigned',
  'assigned-to-me',
  'resolved',
  'breaching-soon',
  'archived',
  'spam',
  'trash',
  'all',
] as const
export type ConversationListView = (typeof CONVERSATION_LIST_VIEWS)[number]

/** Which folder a list view reads: Spam and Trash have their own, everything else is the normal inbox. */
export function folderForView(view: ConversationListView | undefined): 'normal' | 'spam' | 'trash' {
  if (view === 'spam' || view === 'trash') return view
  return 'normal'
}

/**
 * Folder filter for the list query. Normal views hide both Spam and Trash,
 * Spam shows spam that is not trashed, Trash shows everything trashed.
 */
export function folderCondition(view: ConversationListView | undefined) {
  const folder = folderForView(view)
  if (folder === 'trash') return isNotNull(conversation.deletedAt)
  if (folder === 'spam') return and(isNotNull(conversation.spamAt), isNull(conversation.deletedAt))!
  return and(isNull(conversation.spamAt), isNull(conversation.deletedAt))!
}

export interface FolderPatch {
  spam?: boolean
  deleted?: boolean
}

export interface FolderChange {
  field: 'spam' | 'deleted'
  to: boolean
}

/**
 * Work out what a folder patch changes. Pure. Re-sending the current state is
 * not a change. Spam and Trash are timestamps, not statuses, so the
 * conversation keeps its status while it sits in either folder.
 */
export function diffFolderPatch(
  existing: { spamAt?: Date | null; deletedAt?: Date | null },
  patch: FolderPatch,
  now: Date
): { changes: FolderChange[]; updates: Record<string, unknown> } {
  const changes: FolderChange[] = []
  const updates: Record<string, unknown> = {}

  if (patch.spam !== undefined && patch.spam !== Boolean(existing.spamAt)) {
    updates.spamAt = patch.spam ? now : null
    changes.push({ field: 'spam', to: patch.spam })
  }
  if (patch.deleted !== undefined && patch.deleted !== Boolean(existing.deletedAt)) {
    updates.deletedAt = patch.deleted ? now : null
    changes.push({ field: 'deleted', to: patch.deleted })
  }
  return { changes, updates }
}

function describeFolderChange(change: FolderChange): string {
  if (change.field === 'spam') return change.to ? 'Marked as spam.' : 'Marked as not spam.'
  return change.to
    ? `Moved to Trash. It will be deleted permanently after ${TRASH_RETENTION_DAYS} days.`
    : 'Restored from Trash.'
}

/** Append one private activity message per folder change, in the caller's transaction. */
export async function recordFolderActivity(
  tx: Tx,
  conversationId: string,
  changes: FolderChange[],
  actorUserId: string | null
): Promise<void> {
  const now = new Date()
  for (const change of changes) {
    await tx.insert(conversationMessage).values({
      id: randomUUID(),
      conversationId,
      kind: 'activity',
      body: describeFolderChange(change),
      senderKind: 'system',
      senderUserId: actorUserId,
      isPrivate: true,
      createdAt: now,
    })
  }
}

function isMissingObject(error: unknown): boolean {
  const candidate = error as {
    code?: string
    name?: string
    statusCode?: number
    $metadata?: { httpStatusCode?: number }
  }
  return (
    candidate.code === 'OBJECT_NOT_FOUND' ||
    candidate.name === 'NotFound' ||
    candidate.name === 'NoSuchKey' ||
    candidate.statusCode === 404 ||
    candidate.$metadata?.httpStatusCode === 404
  )
}

export interface TrashPurgeResult {
  claimed: number
  purged: number
  objectsDeleted: number
  /** Conversations left in Trash because a storage delete failed; retried next pass. */
  retried: number
}

/**
 * Permanently delete conversations whose `deletedAt` is older than the
 * retention window, in a bounded batch. Messages, attachment rows, upload
 * sessions, tags, read state and status events cascade with the conversation,
 * but the storage objects do not, so they are deleted first. A conversation
 * whose objects cannot all be deleted keeps its rows (and so its keys) and is
 * retried on the next pass; a missing object counts as deleted.
 */
export async function runTrashPurge(
  input: { now?: Date; maxBatch?: number; storage?: StorageProvider } = {}
): Promise<TrashPurgeResult> {
  const now = input.now ?? new Date()
  const maxBatch = Math.max(1, Math.min(input.maxBatch ?? DEFAULT_TRASH_PURGE_BATCH, 100))
  const cutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000)

  const candidates = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(and(isNotNull(conversation.deletedAt), lt(conversation.deletedAt, cutoff)))
    .orderBy(conversation.deletedAt)
    .limit(maxBatch)

  const result: TrashPurgeResult = { claimed: candidates.length, purged: 0, objectsDeleted: 0, retried: 0 }
  if (candidates.length === 0) return result

  const storage = input.storage ?? getStorageProvider()
  const ids = candidates.map((row) => row.id)

  const attachmentRows = await db
    .select({ conversationId: conversationMessage.conversationId, key: conversationAttachment.storageKey })
    .from(conversationAttachment)
    .innerJoin(conversationMessage, eq(conversationAttachment.messageId, conversationMessage.id))
    .where(inArray(conversationMessage.conversationId, ids))
  const uploadRows = await db
    .select({
      conversationId: supportAttachmentUpload.conversationId,
      temp: supportAttachmentUpload.tempStorageKey,
      final: supportAttachmentUpload.finalStorageKey,
    })
    .from(supportAttachmentUpload)
    .where(inArray(supportAttachmentUpload.conversationId, ids))

  const keysByConversation = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]))
  for (const row of attachmentRows) keysByConversation.get(row.conversationId)?.add(row.key)
  for (const row of uploadRows) {
    keysByConversation.get(row.conversationId)?.add(row.temp)
    if (row.final) keysByConversation.get(row.conversationId)?.add(row.final)
  }

  for (const id of ids) {
    let failed = false
    for (const key of keysByConversation.get(id) ?? []) {
      try {
        await storage.deleteObject(key)
        result.objectsDeleted++
      } catch (error) {
        if (!isMissingObject(error)) failed = true
      }
    }
    if (failed) {
      result.retried++
      continue
    }
    // Re-check deletedAt: an agent may have restored it while objects were deleted.
    const deleted = await db
      .delete(conversation)
      .where(and(eq(conversation.id, id), isNotNull(conversation.deletedAt), lt(conversation.deletedAt, cutoff)))
    if (deleted.rowCount === 1) result.purged++
  }
  return result
}
