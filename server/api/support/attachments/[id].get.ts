/**
 * @openapi
 * /api/support/attachments/{id}:
 *   get:
 *     tags: [Support]
 *     summary: Download a conversation attachment
 *     description: >
 *       Serves the bytes through the app rather than exposing a storage URL,
 *       so access is checked on every request. Responses always download
 *       rather than render in the application origin.
 *     operationId: getSupportConversationAttachment
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Attachment bytes }
 *       403: { description: Not a member of this inbox or a team admin }
 *       404: { description: Attachment not found }
 */
import { createError, getRouterParam, setResponseHeader } from 'h3'
import { eq } from 'drizzle-orm'
import { createErrorResponse, ErrorCode } from '~/server/utils/response'
import { requireAuth } from '~/server/utils/auth-middleware'
import { requireConversationAccess } from '~/server/utils/support-access'
import { getStorageProvider } from '~/server/utils/storage'
import { db } from '~/server/database/drizzle'
import { conversationAttachment, conversationMessage } from '~/server/database/schema/support'

function storageReadError(error: unknown): never {
  const candidate = error as {
    code?: string
    name?: string
    statusCode?: number
    $metadata?: { httpStatusCode?: number }
  }
  const missing =
    candidate.code === 'ENOENT' ||
    candidate.code === 'OBJECT_NOT_FOUND' ||
    candidate.name === 'NotFound' ||
    candidate.name === 'NoSuchKey' ||
    candidate.statusCode === 404 ||
    candidate.$metadata?.httpStatusCode === 404

  throw createError({
    statusCode: missing ? 404 : 503,
    statusMessage: missing ? 'Not Found' : 'Service Unavailable',
    data: createErrorResponse(
      missing ? ErrorCode.NOT_FOUND : ErrorCode.INTERNAL_ERROR,
      missing ? 'Attachment not found' : 'Attachment is temporarily unavailable'
    ),
  })
}

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const attachmentId = getRouterParam(event, 'id') as string

  const [row] = await db
    .select({
      storageKey: conversationAttachment.storageKey,
      fileName: conversationAttachment.fileName,
      contentType: conversationAttachment.contentType,
      conversationId: conversationMessage.conversationId,
    })
    .from(conversationAttachment)
    .innerJoin(conversationMessage, eq(conversationAttachment.messageId, conversationMessage.id))
    .where(eq(conversationAttachment.id, attachmentId))
    .limit(1)

  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      data: createErrorResponse(ErrorCode.NOT_FOUND, 'Attachment not found'),
    })
  }

  // Authorized through the owning conversation, so an attachment is exactly as
  // reachable as the ticket it belongs to - never more. Guessing an id gets a
  // 403, not a customer's file.
  await requireConversationAccess(row.conversationId, session.user.id)

  let body: Buffer
  try {
    body = await getStorageProvider().getObject(row.storageKey)
  } catch (error) {
    storageReadError(error)
  }

  setResponseHeader(event, 'Content-Type', row.contentType || 'application/octet-stream')
  const safeFileName = row.fileName
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code > 0x1f && code !== 0x7f
    })
    .join('')
    .replace(/["\\]/g, '_')
    .trim() || 'attachment'
  setResponseHeader(
    event,
    'Content-Disposition',
    `attachment; filename="${safeFileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(safeFileName)}`
  )
  // The download response is deliberately non-inline. Even if a stored MIME
  // is later misclassified, the browser must not sniff or execute it.
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox")
  setResponseHeader(event, 'Cache-Control', 'private, max-age=300')

  return body
})
