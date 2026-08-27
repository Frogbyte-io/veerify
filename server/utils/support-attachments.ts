import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createErrorResponse, ErrorCode } from './response'

/**
 * Agent-side attachment upload (SUP-04-7).
 *
 * Mirrors `server/utils/inbound-attachments.ts`'s caps and `server/utils/
 * upload-token.ts`'s signing pattern, but is deliberately its own module
 * rather than an extension of either:
 *
 * - `inbound-attachments.ts` stores bytes handed to it directly from a parsed
 *   email; there is nothing to presign because the bytes already exist
 *   server-side by the time it runs.
 * - `upload-token.ts`'s payload is typed for project branding assets
 *   (`projectId`, `kind: 'logo' | 'banner'`, with a transform-and-finalize
 *   step); support attachments have no project, no transform, and no
 *   temp-to-final move, since the final key is known up front (conversation
 *   is known before compose starts, unlike the inbound case where the
 *   conversation is resolved later in the same request).
 *
 * `getStorageProvider()` and `StorageProvider` (`server/utils/storage`) are
 * the actually-shared, driver-agnostic layer and are reused unmodified.
 */

/** Per-part ceiling. Matches Stage 03's inbound cap - the same "one email" budget applies in both directions. */
export const SUPPORT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** Per-message ceiling across all parts. Enforced by Task 8 once the full attachment list is known. */
export const SUPPORT_MAX_MESSAGE_ATTACHMENT_BYTES = 25 * 1024 * 1024

/**
 * Content types an agent may attach. Unlike inbound (which only caps size -
 * a customer's mail is stored and served, not previewed inline), outbound
 * attachments come from a type-in field an agent controls, so a real
 * allowlist is worth having. No HTML or SVG: both can carry script, and nothing
 * here is sandboxed the way `/api/support/attachments/{id}` sandboxes inline
 * images on download.
 */
export const ALLOWED_ATTACHMENT_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
])

export const ATTACHMENT_UPLOAD_EXPIRES_SECONDS = 15 * 60

function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() || 'attachment'
  const cleaned = base
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return cleaned || 'attachment'
}

/**
 * Keyed by conversation, not by an upload session: the conversation is known
 * before compose starts (unlike inbound, keyed by delivery because the
 * conversation isn't resolved yet at that point), so the object can be
 * written straight to its final location - no temp-then-move step needed.
 */
export function buildOutboundAttachmentStorageKey(conversationId: string, attachmentId: string, filename: string) {
  return `support/attachments/outbound/${conversationId}/${attachmentId}/${sanitizeFilename(filename)}`
}

export function createSupportUploadTempKey(uploadId: string, fileName: string) {
  return `support/attachments/uploads/${uploadId}/${sanitizeFilename(fileName)}`
}

export function createSupportAttachmentFinalKey(attachmentId: string, fileName: string) {
  return `support/attachments/outbound/${attachmentId}/${sanitizeFilename(fileName)}`
}

export function validateAttachmentUploadInput(contentType: string, sizeBytes: number) {
  if (!ALLOWED_ATTACHMENT_CONTENT_TYPES.has(contentType)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Validation failed',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, `Unsupported attachment type: ${contentType}`),
    })
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > SUPPORT_MAX_ATTACHMENT_BYTES) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Validation failed',
      data: createErrorResponse(
        ErrorCode.VALIDATION_ERROR,
        `Attachment is too large. Maximum size is ${Math.floor(SUPPORT_MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB`
      ),
    })
  }
}

export interface SupportUploadTokenPayload {
  uploadId: string
  exp: number
}

function toBase64Url(value: string) {
  return Buffer.from(value).toString('base64url')
}

function fromBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function getUploadTokenSecret() {
  const config = useRuntimeConfig()
  const secret = String(config.uploadTokenSecret || '')
  if (!secret) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Upload token secret missing',
      data: createErrorResponse(ErrorCode.INTERNAL_ERROR, 'Missing UPLOAD_TOKEN_SECRET'),
    })
  }
  return secret
}

function signPayload(payloadBase64: string, secret: string) {
  return createHmac('sha256', secret).update(payloadBase64).digest('base64url')
}

function invalidTokenError(message: string): never {
  throw createError({
    statusCode: 400,
    statusMessage: 'Invalid upload token',
    data: createErrorResponse(ErrorCode.VALIDATION_ERROR, message),
  })
}

export function signSupportUploadToken(input: { uploadId: string; expiresAt: Date }): string {
  const secret = getUploadTokenSecret()
  const exp = Math.floor(input.expiresAt.getTime() / 1000)
  if (!input.uploadId || !Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
    invalidTokenError('Upload token input is invalid')
  }
  const completePayload: SupportUploadTokenPayload = { uploadId: input.uploadId, exp }
  const payloadBase64 = toBase64Url(JSON.stringify(completePayload))
  const signature = signPayload(payloadBase64, secret)
  return `${payloadBase64}.${signature}`
}

export function verifySupportUploadToken(token: string): { uploadId: string; expiresAt: Date } {
  const secret = getUploadTokenSecret()
  const pieces = token.split('.')
  const [payloadBase64, signature] = pieces
  if (pieces.length !== 2 || !payloadBase64 || !signature || !/^[A-Za-z0-9_-]+$/.test(payloadBase64) || !/^[A-Za-z0-9_-]+$/.test(signature)) {
    invalidTokenError('Malformed upload token')
  }

  const expectedSignature = signPayload(payloadBase64, secret)
  const providedBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    invalidTokenError('Upload token signature is invalid')
  }

  let payload: SupportUploadTokenPayload | null = null
  try {
    payload = JSON.parse(fromBase64Url(payloadBase64)) as SupportUploadTokenPayload
  } catch {
    invalidTokenError('Failed to parse upload token')
  }

  if (
    !payload ||
    !payload.uploadId ||
    typeof payload.uploadId !== 'string' ||
    Object.keys(payload).some((key) => !['uploadId', 'exp'].includes(key))
  ) {
    invalidTokenError('Upload token payload is incomplete')
  }

  const nowUnix = Math.floor(Date.now() / 1000)
  if (!Number.isFinite(payload.exp) || payload.exp <= nowUnix) {
    invalidTokenError('Upload token has expired')
  }

  return { uploadId: payload.uploadId, expiresAt: new Date(payload.exp * 1000) }
}

export function newAttachmentId(): string {
  return randomUUID()
}
