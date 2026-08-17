/**
 * @openapi
 * /api/support/attachments/{id}:
 *   get:
 *     tags: [Support]
 *     summary: Download a conversation attachment
 *     description: >
 *       Serves the bytes through the app rather than exposing a storage URL,
 *       so access is checked on every request. Inline images in a sanitized
 *       message body point here.
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

export default defineEventHandler(async (event) => {
  const session = await requireAuth(event)
  const attachmentId = getRouterParam(event, 'id') as string

  const [row] = await db
    .select({
      storageKey: conversationAttachment.storageKey,
      fileName: conversationAttachment.fileName,
      contentType: conversationAttachment.contentType,
      isInline: conversationAttachment.isInline,
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

  const body = await getStorageProvider().getObject(row.storageKey)

  setResponseHeader(event, 'Content-Type', row.contentType || 'application/octet-stream')
  // Inline images render in place; everything else downloads rather than
  // rendering, so an HTML or SVG attachment cannot execute in our origin.
  setResponseHeader(
    event,
    'Content-Disposition',
    row.isInline
      ? `inline; filename="${encodeURIComponent(row.fileName)}"`
      : `attachment; filename="${encodeURIComponent(row.fileName)}"`
  )
  // Belt and braces for the inline case: even served inline, the browser must
  // not sniff a different type, and nothing here may run script.
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  setResponseHeader(event, 'Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox")
  setResponseHeader(event, 'Cache-Control', 'private, max-age=300')

  return body
})
