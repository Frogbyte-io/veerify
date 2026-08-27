import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { supportAttachmentUpload } from '~/server/database/schema/support'
import { getStorageProvider } from '~/server/utils/storage'
import type { StorageProvider } from '~/server/utils/storage/types'

type CleanupStatus = 'pending' | 'uploaded' | 'finalizing' | 'cleanup_required' | 'consumed'

export const DEFAULT_ATTACHMENT_CLEANUP_BATCH = 25
export const ATTACHMENT_CLEANUP_LEASE_SECONDS = 5 * 60

export interface AttachmentCleanupResult {
  claimed: number
  expired: number
  restored: number
  consumedTempDeleted: number
  deleted: number
  retried: number
}

interface ClaimedUpload {
  id: string
  status: CleanupStatus
  tempStorageKey: string
  finalStorageKey: string | null
  expiresAt: Date
  tempDeletedAt: Date | null
  claimLease: Date
}

function parsePgTimestamp(value: unknown): Date {
  if (value instanceof Date) return new Date(value.getTime())
  const text = String(value)
  return new Date(text.includes('T') ? `${text}Z` : `${text.replace(' ', 'T')}Z`)
}

function isMissingObject(error: unknown): boolean {
  const candidate = error as { code?: string; name?: string; statusCode?: number; $metadata?: { httpStatusCode?: number } }
  return (
    candidate.code === 'OBJECT_NOT_FOUND' ||
    candidate.name === 'NotFound' ||
    candidate.name === 'NoSuchKey' ||
    candidate.statusCode === 404 ||
    candidate.$metadata?.httpStatusCode === 404
  )
}

/** Store only a closed reason code: provider messages may contain paths or credentials. */
function safeCleanupError(error: unknown): string {
  void error
  return 'STORAGE_DELETE_FAILED'
}

async function claimUploads(now: Date, maxBatch: number): Promise<ClaimedUpload[]> {
  const lease = new Date(now.getTime() + ATTACHMENT_CLEANUP_LEASE_SECONDS * 1000)
  // The upload table uses PostgreSQL `timestamp` (without time zone). Bind an
  // explicit UTC string in raw SQL; binding a JS Date lets node-postgres apply
  // the host's local offset before PostgreSQL sees it.
  const nowSql = now.toISOString().replace('T', ' ').replace('Z', '')
  const leaseSql = lease.toISOString().replace('T', ' ').replace('Z', '')
  const result = await db.execute<Record<string, unknown>>(sql`
    WITH candidates AS (
      SELECT id
      FROM support_attachment_upload
      WHERE (
        (status IN ('pending', 'uploaded') AND expires_at <= ${nowSql})
        OR (status = 'finalizing' AND finalize_lease_expires_at IS NOT NULL AND finalize_lease_expires_at < ${nowSql})
        OR (status = 'cleanup_required')
        OR (status = 'consumed' AND temp_deleted_at IS NULL)
      )
        AND (finalize_lease_expires_at IS NULL OR finalize_lease_expires_at < ${nowSql})
      ORDER BY id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${maxBatch}
    )
    UPDATE support_attachment_upload AS upload
    SET
      status = CASE WHEN upload.status = 'finalizing' THEN 'cleanup_required' ELSE upload.status END,
      finalize_lease_expires_at = ${leaseSql},
      updated_at = ${nowSql}
    FROM candidates
    WHERE upload.id = candidates.id
    RETURNING upload.*
  `)

  return result.rows.map((row) => ({
    id: String(row.id),
    status: String(row.status) as CleanupStatus,
    tempStorageKey: String(row.temp_storage_key),
    finalStorageKey: row.final_storage_key ? String(row.final_storage_key) : null,
    expiresAt: parsePgTimestamp(row.expires_at),
    tempDeletedAt: row.temp_deleted_at ? parsePgTimestamp(row.temp_deleted_at) : null,
    claimLease: parsePgTimestamp(row.finalize_lease_expires_at),
  }))
}

async function markRetry(row: ClaimedUpload, error: unknown, now: Date): Promise<boolean> {
  const result = await db
    .update(supportAttachmentUpload)
    .set({
      cleanupAttemptCount: sql`${supportAttachmentUpload.cleanupAttemptCount} + 1`,
      cleanupLastError: safeCleanupError(error),
      finalizeLeaseExpiresAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(supportAttachmentUpload.id, row.id),
        eq(supportAttachmentUpload.finalizeLeaseExpiresAt, row.claimLease),
        // A stale worker may not mutate a row after another worker has claimed
        // it or changed its state.
        eq(supportAttachmentUpload.status, row.status)
      )
    )
  return result.rowCount === 1
}

async function completeExpired(row: ClaimedUpload, now: Date, tempDeleted: boolean): Promise<boolean> {
  const result = await db
    .update(supportAttachmentUpload)
    .set({
      status: 'expired',
      tempDeletedAt: tempDeleted ? now : row.tempDeletedAt,
      finalizeLeaseExpiresAt: null,
      cleanupLastError: null,
      updatedAt: now,
    })
    .where(and(eq(supportAttachmentUpload.id, row.id), eq(supportAttachmentUpload.status, row.status), eq(supportAttachmentUpload.finalizeLeaseExpiresAt, row.claimLease)))
  return result.rowCount === 1
}

async function completeConsumed(row: ClaimedUpload, now: Date): Promise<boolean> {
  const result = await db
    .update(supportAttachmentUpload)
    .set({ tempDeletedAt: now, finalizeLeaseExpiresAt: null, cleanupLastError: null, updatedAt: now })
    .where(and(eq(supportAttachmentUpload.id, row.id), eq(supportAttachmentUpload.status, 'consumed'), eq(supportAttachmentUpload.finalizeLeaseExpiresAt, row.claimLease)))
  return result.rowCount === 1
}

async function completeFinalCleanup(row: ClaimedUpload, now: Date, tempDeleted: boolean): Promise<{ updated: boolean; outcome: 'restored' | 'expired' }> {
  const expired = row.expiresAt.getTime() <= now.getTime()
  const patch = expired
    ? { status: 'expired' as const, finalStorageKey: null, tempDeletedAt: tempDeleted ? now : row.tempDeletedAt }
    : { status: 'uploaded' as const, finalStorageKey: null, tempDeletedAt: null }
  const result = await db
    .update(supportAttachmentUpload)
    .set({ ...patch, finalizeLeaseExpiresAt: null, cleanupLastError: null, updatedAt: now })
    .where(and(eq(supportAttachmentUpload.id, row.id), eq(supportAttachmentUpload.status, 'cleanup_required'), eq(supportAttachmentUpload.finalizeLeaseExpiresAt, row.claimLease)))
  return { updated: result.rowCount === 1, outcome: expired ? 'expired' : 'restored' }
}

/**
 * Reclaim a bounded batch of abandoned upload sessions. Database claims are
 * short and committed before provider calls, so a slow provider never holds a
 * row lock. Every external deletion is followed by an exact lease/state guard.
 */
export async function runAttachmentCleanup(input: {
  now?: Date
  maxBatch?: number
  storage?: StorageProvider
} = {}): Promise<AttachmentCleanupResult> {
  const currentTime = () => input.now ?? new Date()
  const claimTime = currentTime()
  const maxBatch = Math.max(1, Math.min(input.maxBatch ?? DEFAULT_ATTACHMENT_CLEANUP_BATCH, 100))
  const storage = input.storage ?? getStorageProvider()
  const claimed = await claimUploads(claimTime, maxBatch)
  const result: AttachmentCleanupResult = { claimed: claimed.length, expired: 0, restored: 0, consumedTempDeleted: 0, deleted: 0, retried: 0 }

  for (const row of claimed) {
    try {
      if (row.status === 'consumed') {
        if (row.tempDeletedAt) {
          await completeConsumed(row, currentTime())
          continue
        }
        try { await storage.deleteObject(row.tempStorageKey) } catch (error) { if (!isMissingObject(error)) throw error }
        if (await completeConsumed(row, currentTime())) {
          result.consumedTempDeleted++
          result.deleted++
        }
        continue
      }

      if (row.status === 'pending' || row.status === 'uploaded') {
        try { await storage.deleteObject(row.tempStorageKey) } catch (error) { if (!isMissingObject(error)) throw error }
        if (await completeExpired(row, currentTime(), true)) {
          result.expired++
          result.deleted++
        }
        continue
      }

      // A stale finalization is claimed as cleanup_required. Delete the final
      // orphan first; only then may its key be cleared or the row restored.
      if (row.finalStorageKey) {
        try { await storage.deleteObject(row.finalStorageKey) } catch (error) { if (!isMissingObject(error)) throw error }
        result.deleted++
      }
      let tempDeleted = Boolean(row.tempDeletedAt)
      const completionTime = currentTime()
      if (row.expiresAt.getTime() <= completionTime.getTime()) {
        try { await storage.deleteObject(row.tempStorageKey) } catch (error) { if (!isMissingObject(error)) throw error }
        tempDeleted = true
      }
      const outcome = await completeFinalCleanup(row, completionTime, tempDeleted)
      if (outcome.updated) {
        if (outcome.outcome === 'expired') result.expired++
        else result.restored++
      }
    } catch (error) {
      if (await markRetry(row, error, currentTime())) result.retried++
    }
  }
  return result
}
