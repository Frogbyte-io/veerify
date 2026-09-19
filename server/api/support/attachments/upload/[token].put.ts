/**
 * @openapi
 * /api/support/attachments/upload/{token}:
 *   put:
 *     tags: [Support]
 *     summary: Stream bytes into a server-owned attachment upload session
 *     description: The token identifies only a pending upload session. The application enforces the 10 MB limit while consuming the request stream and never accepts a caller-supplied storage key.
 *     operationId: uploadSupportAttachment
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Uploaded }
 *       400: { description: Invalid token, content-type mismatch, or missing body }
 *       404: { description: Upload session not found }
 *       409: { description: Upload session has already been used }
 *       413: { description: Upload exceeds the 10 MB limit }
 */
import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { finished } from 'node:stream/promises'
import { once } from 'node:events'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { createErrorResponse, createSuccessResponse, ErrorCode } from '~/server/utils/response'
import { getStorageProvider } from '~/server/utils/storage'
import { db } from '~/server/database/drizzle'
import { supportAttachmentUpload } from '~/server/database/schema/support'
import { SUPPORT_MAX_ATTACHMENT_BYTES, verifySupportUploadToken } from '~/server/utils/support-attachments'

function uploadError(statusCode: number, message: string): never {
  throw createError({
    statusCode,
    statusMessage: statusCode === 413 ? 'Payload Too Large' : 'Validation failed',
    data: createErrorResponse(ErrorCode.VALIDATION_ERROR, message),
  })
}

function normalizeContentType(value: string) {
  return value.split(';')[0].trim().toLowerCase()
}

async function streamBoundedBody(event: H3Event): Promise<{ filePath: string; directory: string; sizeBytes: number }> {
  const request = event?.node?.req
  if (!request || typeof request[Symbol.asyncIterator] !== 'function') uploadError(400, 'Upload body is required')

  const contentLength = Number(getHeader(event, 'content-length') || 0)
  if (contentLength > SUPPORT_MAX_ATTACHMENT_BYTES) {
    if (typeof request.pause === 'function') request.pause()
    uploadError(413, 'Attachment exceeds the 10 MB limit')
  }

  const directory = await mkdtemp(join(tmpdir(), 'veerify-attachment-'))
  const filePath = join(directory, 'upload')
  const output = createWriteStream(filePath, { flags: 'wx' })
  let sizeBytes = 0
  try {
    for await (const value of request as AsyncIterable<Buffer | Uint8Array | string>) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      sizeBytes += chunk.byteLength
      if (sizeBytes > SUPPORT_MAX_ATTACHMENT_BYTES) {
        output.destroy()
        if (typeof request.pause === 'function') request.pause()
        uploadError(413, 'Attachment exceeds the 10 MB limit')
      }
      if (!output.write(chunk)) await once(output, 'drain')
    }
    output.end()
    await finished(output)
    if (sizeBytes === 0) uploadError(400, 'Upload body is required')
    return { filePath, directory, sizeBytes }
  } catch (error) {
    output.destroy()
    await finished(output).catch(() => undefined)
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export default defineEventHandler(async (event) => {
  const tokenParam = getRouterParam(event, 'token')
  if (!tokenParam) uploadError(400, 'Upload token is required')
  const token = verifySupportUploadToken(decodeURIComponent(tokenParam))
  const contentType = normalizeContentType(String(getHeader(event, 'content-type') || ''))
  if (!contentType) uploadError(400, 'Upload content type is required')

  // Read the session without holding a transaction. Streaming a 10 MB body and
  // two storage round trips inside `db.transaction` pins a pooled connection for
  // the whole transfer, so a handful of deliberately slow uploads can occupy the
  // entire pool and stall every other query in the process. The durable state
  // machine does not need the connection held: the short transaction at the end
  // re-reads the row `FOR UPDATE` and re-checks every precondition, so a session
  // consumed concurrently still loses cleanly.
  const [preflight] = await db
    .select()
    .from(supportAttachmentUpload)
    .where(eq(supportAttachmentUpload.id, token.uploadId))
    .limit(1)
  if (!preflight) uploadError(404, 'Upload session not found')
  if (preflight.status !== 'pending') uploadError(409, 'Upload session has already been used')
  if (preflight.expiresAt.getTime() <= Date.now() || token.expiresAt.getTime() <= Date.now())
    uploadError(400, 'Upload session has expired')
  if (preflight.requestedContentType !== contentType)
    uploadError(400, 'Upload content type does not match the presigned type')

  const { filePath, directory, sizeBytes } = await streamBoundedBody(event)
  const storage = getStorageProvider()
  let stored = false
  try {
    await storage.putObject({ key: preflight.tempStorageKey, buffer: await readFile(filePath), contentType })
    stored = true
    const metadata = await storage.headObject(preflight.tempStorageKey)
    if (metadata.sizeBytes !== preflight.requestedSizeBytes || metadata.sizeBytes !== sizeBytes) {
      uploadError(400, 'Uploaded size does not match the presigned size')
    }
    if (metadata.contentType && metadata.contentType !== contentType) {
      uploadError(400, 'Uploaded content type does not match the presigned type')
    }

    const committed = await db.transaction(async (tx) => {
      const [upload] = await tx
        .select()
        .from(supportAttachmentUpload)
        .where(eq(supportAttachmentUpload.id, token.uploadId))
        .for('update')
        .limit(1)
      // Re-checked under the lock, not merely re-read: between the preflight and
      // here another request may have consumed or expired this session.
      if (!upload) return false
      if (upload.status !== 'pending') return false
      if (upload.expiresAt.getTime() <= Date.now()) return false
      if (upload.requestedContentType !== contentType) return false

      // The row is held `FOR UPDATE` and its status was just re-checked in this
      // same transaction, so the status predicate here cannot fail. It is kept
      // as a defensive assertion of the state this write assumes.
      await tx
        .update(supportAttachmentUpload)
        .set({
          storedContentType: contentType,
          actualSizeBytes: metadata.sizeBytes,
          objectVersion: metadata.objectVersion,
          uploadedAt: new Date(),
          status: 'uploaded',
          updatedAt: new Date(),
        })
        .where(and(eq(supportAttachmentUpload.id, upload.id), eq(supportAttachmentUpload.status, 'pending')))
      return true
    })

    if (!committed) {
      // The object is orphaned by definition: no row now references it.
      await storage.deleteObject(preflight.tempStorageKey).catch(() => undefined)
      uploadError(409, 'Upload session has already been used')
    }

    return createSuccessResponse({ uploaded: true, uploadId: preflight.id, sizeBytes: metadata.sizeBytes })
  } catch (error) {
    if (stored) await storage.deleteObject(preflight.tempStorageKey).catch(() => undefined)
    throw error
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
})
