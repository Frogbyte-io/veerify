import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { createError } from 'h3'
import { db } from '~/server/database/drizzle'
import {
  conversation,
  conversationAttachment,
  conversationMessage,
  supportAttachmentUpload,
} from '~/server/database/schema/support'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { enqueueOutboundDelivery } from '~/server/utils/outbound-delivery'
import type { OutgoingReplyResult } from '~/server/utils/outbound-reply'
import { getStorageProvider } from '~/server/utils/storage'
import type { StorageObjectMetadata, StorageProvider } from '~/server/utils/storage/types'
import {
  createSupportAttachmentFinalKey,
  SUPPORT_MAX_ATTACHMENT_BYTES,
  SUPPORT_MAX_MESSAGE_ATTACHMENT_BYTES,
} from '~/server/utils/support-attachments'

type UploadRow = typeof supportAttachmentUpload.$inferSelect
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export const ATTACHMENT_FINALIZATION_LEASE_SECONDS = 5 * 60

export interface AttachmentFinalizationReservation {
  uploadId: string
  conversationId: string
  userId: string
  tempStorageKey: string
  finalStorageKey: string
  fileName: string
  storedContentType: string
  actualSizeBytes: number
  objectVersion: string
  leaseExpiresAt: Date
}

function finalizationError(statusCode: number, message: string): never {
  throw createError({
    statusCode,
    statusMessage: statusCode === 404 ? 'Not Found' : statusCode === 400 ? 'Validation failed' : 'Conflict',
    data: createErrorResponse(
      statusCode === 404 ? ErrorCode.NOT_FOUND : statusCode === 400 ? ErrorCode.VALIDATION_ERROR : ErrorCode.CONFLICT,
      message
    ),
  })
}

function missingUpload(): never {
  finalizationError(404, 'Attachment upload not found')
}

function unavailableUpload(): never {
  finalizationError(409, 'Attachment upload is not available')
}

function reservationFromRow(row: UploadRow): AttachmentFinalizationReservation {
  if (!row.finalStorageKey || !row.storedContentType || row.actualSizeBytes === null || !row.objectVersion) {
    unavailableUpload()
  }
  if (!row.finalizeLeaseExpiresAt) unavailableUpload()
  return {
    uploadId: row.id,
    conversationId: row.conversationId,
    userId: row.userId,
    tempStorageKey: row.tempStorageKey,
    finalStorageKey: row.finalStorageKey,
    fileName: row.fileName,
    storedContentType: row.storedContentType,
    actualSizeBytes: row.actualSizeBytes,
    objectVersion: row.objectVersion,
    leaseExpiresAt: row.finalizeLeaseExpiresAt,
  }
}

async function lockUploads(tx: Tx, uploadIds: string[]) {
  return tx
    .select()
    .from(supportAttachmentUpload)
    .where(inArray(supportAttachmentUpload.id, uploadIds))
    .orderBy(asc(supportAttachmentUpload.id))
    .for('update')
}

/** Mark only rows that still carry this reservation as cleanup work. */
export async function markAttachmentCleanupRequired(
  reservation: AttachmentFinalizationReservation[],
  error?: unknown
): Promise<void> {
  if (reservation.length === 0) return
  // Provider errors can contain storage keys, local paths, or request details.
  // Persist a closed reason code rather than treating an arbitrary provider
  // message as safe operational data.
  void error
  const message = 'ATTACHMENT_FINALIZATION_FAILED'
  await db.transaction(async (tx) => {
    for (const item of [...reservation].sort((a, b) => a.uploadId.localeCompare(b.uploadId))) {
      await tx
        .update(supportAttachmentUpload)
        .set({
          status: 'cleanup_required',
          finalizeLeaseExpiresAt: null,
          cleanupLastError: message,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(supportAttachmentUpload.id, item.uploadId),
            eq(supportAttachmentUpload.status, 'finalizing'),
            eq(supportAttachmentUpload.finalStorageKey, item.finalStorageKey)
          )
        )
    }
  })
}

async function verifyAndCopy(
  reservation: AttachmentFinalizationReservation[],
  storage: StorageProvider
): Promise<void> {
  for (const item of reservation) {
    let metadata: StorageObjectMetadata
    try {
      metadata = await storage.headObject(item.tempStorageKey)
    } catch (error) {
      throw new Error(`Attachment source is unavailable: ${item.uploadId}`, { cause: error })
    }
    if (
      metadata.sizeBytes !== item.actualSizeBytes ||
      metadata.sizeBytes > SUPPORT_MAX_ATTACHMENT_BYTES ||
      (metadata.contentType === null
        ? storage.driver !== 'local'
        : metadata.contentType !== item.storedContentType) ||
      metadata.objectVersion !== item.objectVersion
    ) {
      throw new Error(`Attachment source changed: ${item.uploadId}`)
    }
    const copied = await storage.copyObject(item.tempStorageKey, item.finalStorageKey, {
      contentType: item.storedContentType,
      ifMatch: item.objectVersion,
    })
    if (copied.sizeBytes !== item.actualSizeBytes || copied.contentType !== item.storedContentType) {
      throw new Error(`Attachment destination metadata is invalid: ${item.uploadId}`)
    }
  }
}

/** Reserve uploaded rows, commit that state, then copy verified temp objects. */
export async function reserveAttachmentFinalization(input: {
  uploadIds: string[]
  conversationId: string
  userId: string
  now?: Date
  storage?: StorageProvider
}): Promise<AttachmentFinalizationReservation[]> {
  if (input.uploadIds.length === 0) return []
  if (new Set(input.uploadIds).size !== input.uploadIds.length) {
    finalizationError(400, 'Duplicate attachment upload ids are not allowed')
  }

  const rows = await db.transaction(async (tx) => {
    const locked = await lockUploads(tx, input.uploadIds)
    // Read the clock only after any row-lock wait. Otherwise an upload can
    // expire while queued and still be reserved using a stale timestamp.
    const now = input.now ?? new Date()
    const leaseExpiresAt = new Date(now.getTime() + ATTACHMENT_FINALIZATION_LEASE_SECONDS * 1000)
    if (locked.length !== input.uploadIds.length) missingUpload()
    const ordered = new Map(locked.map((row) => [row.id, row]))
    const selected = input.uploadIds.map((id) => ordered.get(id)!)
    let total = 0
    for (const row of selected) {
      // A foreign row is deliberately indistinguishable from a missing row.
      if (row.userId !== input.userId || row.conversationId !== input.conversationId) missingUpload()
      if (row.status === 'cleanup_required') {
        finalizationError(409, 'Attachment cleanup is still in progress. Please retry shortly.')
      }
      if (row.status !== 'uploaded' || row.expiresAt.getTime() <= now.getTime()) unavailableUpload()
      if (
        !row.storedContentType ||
        row.actualSizeBytes === null ||
        !row.objectVersion ||
        row.actualSizeBytes <= 0 ||
        row.actualSizeBytes > SUPPORT_MAX_ATTACHMENT_BYTES
      )
        unavailableUpload()
      total += row.actualSizeBytes
    }
    if (total > SUPPORT_MAX_MESSAGE_ATTACHMENT_BYTES) {
      finalizationError(400, 'Attachments exceed the 25 MB per-message limit')
    }
    const reservations: AttachmentFinalizationReservation[] = []
    for (const row of selected) {
      const finalStorageKey = createSupportAttachmentFinalKey(randomUUID(), row.fileName)
      await tx
        .update(supportAttachmentUpload)
        .set({ status: 'finalizing', finalStorageKey, finalizeLeaseExpiresAt: leaseExpiresAt, updatedAt: now })
        .where(eq(supportAttachmentUpload.id, row.id))
      reservations.push(
        reservationFromRow({ ...row, status: 'finalizing', finalStorageKey, finalizeLeaseExpiresAt: leaseExpiresAt })
      )
    }
    return reservations
  })

  try {
    const storage = input.storage ?? getStorageProvider()
    await verifyAndCopy(rows, storage)
    return rows
  } catch (error) {
    // Provider construction and external copy both happen after the durable
    // reservation, so every failure enters the same cleanup boundary.
    await markAttachmentCleanupRequired(rows, error)
    throw error
  }
}

export interface CommitMessageWithAttachmentsInput {
  reservation: AttachmentFinalizationReservation[]
  conversationId: string
  userId: string
  now?: Date
  message: {
    id: string
    kind: string
    body: string
    bodyHtml: string | null
    isPrivate: boolean
    channelMessageId: string | null
    inReplyTo: string | null
    channelHeaders: Record<string, string> | null
    deliveryStatus: string
  }
  existingConversation: typeof conversation.$inferSelect
  outgoing: OutgoingReplyResult | null
}

/** Insert the canonical message graph and consume the reservation atomically. */
export async function commitMessageWithAttachments(
  input: CommitMessageWithAttachmentsInput
): Promise<typeof conversationMessage.$inferSelect> {
  try {
    return await db.transaction(async (tx) => {
      const uploadIds = input.reservation.map((item) => item.uploadId)
      const locked = uploadIds.length > 0 ? await lockUploads(tx, uploadIds) : []
      // As with reservation, validate after acquiring every row lock so time
      // spent waiting counts against both the upload expiry and lease.
      const now = input.now ?? new Date()
      if (locked.length !== uploadIds.length) missingUpload()
      const byId = new Map(locked.map((row) => [row.id, row]))
      for (const item of input.reservation) {
        const row = byId.get(item.uploadId)
        if (
          !row ||
          row.userId !== input.userId ||
          row.conversationId !== input.conversationId ||
          row.status !== 'finalizing' ||
          row.finalStorageKey !== item.finalStorageKey ||
          row.objectVersion !== item.objectVersion ||
          row.expiresAt.getTime() <= now.getTime() ||
          row.finalizeLeaseExpiresAt === null ||
          row.finalizeLeaseExpiresAt.getTime() !== item.leaseExpiresAt.getTime() ||
          row.finalizeLeaseExpiresAt.getTime() <= now.getTime()
        ) {
          unavailableUpload()
        }
      }

      const [message] = await tx
        .insert(conversationMessage)
        .values({
          ...input.message,
          conversationId: input.conversationId,
          senderKind: 'agent',
          senderContactId: null,
          senderUserId: input.userId,
          createdAt: now,
        })
        .returning()

      if (input.outgoing && input.reservation.length > 0) {
        await tx.insert(conversationAttachment).values(
          input.reservation.map((item) => ({
            id: randomUUID(),
            messageId: message.id,
            storageKey: item.finalStorageKey,
            fileName: item.fileName,
            contentType: item.storedContentType,
            sizeBytes: item.actualSizeBytes,
            isInline: false,
            contentId: null,
            createdAt: now,
          }))
        )
      }

      const conversationUpdates: Partial<typeof conversation.$inferInsert> = {
        lastActivityAt: now,
        updatedAt: now,
      }
      if (input.outgoing) {
        conversationUpdates.lastAgentReplyAt = now
        if (!input.existingConversation.firstResponseAt) conversationUpdates.firstResponseAt = now
      }
      await tx.update(conversation).set(conversationUpdates).where(eq(conversation.id, input.conversationId))
      if (input.outgoing) {
        // The caller cannot smuggle request data into the durable outbox.
        // Rebuild the attachment references from the locked reservation.
        const deliveryPayload = {
          ...input.outgoing.deliveryPayload,
          attachments:
            input.reservation.length > 0
              ? input.reservation.map((item) => ({
                  filename: item.fileName,
                  contentType: item.storedContentType,
                  storageKey: item.finalStorageKey,
                }))
              : undefined,
        }
        await enqueueOutboundDelivery(tx, { messageId: message.id, payload: deliveryPayload })
      }
      for (const item of input.reservation) {
        await tx
          .update(supportAttachmentUpload)
          .set({
            status: 'consumed',
            messageId: message.id,
            consumedAt: now,
            finalizeLeaseExpiresAt: null,
            updatedAt: now,
          })
          .where(eq(supportAttachmentUpload.id, item.uploadId))
      }
      return message
    })
  } catch (error) {
    await markAttachmentCleanupRequired(input.reservation, error)
    throw error
  }
}
