import { createHmac, timingSafeEqual } from 'node:crypto'
import sharp from 'sharp'
import { FEEDBACK_ATTACHMENT_MAX_BYTES, FEEDBACK_ATTACHMENT_MAX_COUNT } from '../../lib/feedback-attachment-limits'
import { createErrorResponse, ErrorCode } from './response'

/**
 * Feedback attachments (images, logs, PDFs).
 *
 * Mirrors the support attachment pipeline (`support-attachments.ts`): presign
 * -> direct/proxied upload -> server-side finalize that re-validates size and
 * sniffs content -> reference row. Unlike branding assets these objects are
 * private: keys live under `feedback-attachments/` and are only handed out via
 * short-lived signed URLs after an authorization decision.
 */

export { FEEDBACK_ATTACHMENT_MAX_COUNT, FEEDBACK_ATTACHMENT_MAX_BYTES }
export const FEEDBACK_ATTACHMENT_UPLOAD_EXPIRES_SECONDS = 15 * 60
export const FEEDBACK_ATTACHMENT_DOWNLOAD_EXPIRES_SECONDS = 5 * 60
/** Pending / never-attached uploads older than this are removed by the cleanup task. */
export const FEEDBACK_ATTACHMENT_PENDING_TTL_MS = 24 * 60 * 60 * 1000
export const FEEDBACK_ATTACHMENT_KEY_PREFIX = 'feedback-attachments'
const MAX_IMAGE_PIXELS = 50_000_000

export type FeedbackAttachmentKind = 'image' | 'log' | 'file'

export interface SniffedAttachment {
  contentType: string
  kind: FeedbackAttachmentKind
  /** Lower-case extension (with dot) used for the stored name. */
  extension: string
}

const IMAGE_EXTENSIONS: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
}
const TEXT_EXTENSIONS: Record<string, string> = {
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.json': 'application/json',
}

/** Content types a client may declare at presign time (octet-stream is tolerated for text logs only). */
export const FEEDBACK_ATTACHMENT_DECLARED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'application/json',
  'application/octet-stream',
  'text/x-log',
])

export function feedbackAttachmentError(statusCode: number, message: string): never {
  throw createError({
    statusCode,
    statusMessage:
      statusCode === 404
        ? 'Not Found'
        : statusCode === 403
          ? 'Forbidden'
          : statusCode === 409
            ? 'Conflict'
            : statusCode === 413
              ? 'Payload Too Large'
              : statusCode === 429
                ? 'Too Many Requests'
                : 'Validation failed',
    data: createErrorResponse(
      statusCode === 404
        ? ErrorCode.NOT_FOUND
        : statusCode === 403
          ? ErrorCode.FORBIDDEN
          : statusCode === 409
            ? ErrorCode.CONFLICT
            : statusCode === 429
              ? ErrorCode.RATE_LIMITED
              : ErrorCode.VALIDATION_ERROR,
      message
    ),
  })
}

export function sanitizeFeedbackAttachmentFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() || 'attachment'
  const cleaned = base
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return (cleaned || 'attachment').slice(0, 120)
}

export function buildFeedbackAttachmentKey(projectId: string, attachmentId: string, fileName: string) {
  return `${FEEDBACK_ATTACHMENT_KEY_PREFIX}/${projectId}/${attachmentId}/${sanitizeFeedbackAttachmentFilename(fileName)}`
}

function extensionOf(fileName: string): string {
  const match = /\.[A-Za-z0-9]+$/.exec(fileName)
  return match ? match[0].toLowerCase() : ''
}

/**
 * Cheap pre-flight check at presign time. This is advisory (the client controls
 * every input); `sniffFeedbackAttachment` is the real gate at finalize time.
 */
export function validateFeedbackAttachmentRequest(fileName: string, declaredContentType: string, sizeBytes: number) {
  const type = declaredContentType.trim().toLowerCase().split(';')[0]
  if (!FEEDBACK_ATTACHMENT_DECLARED_TYPES.has(type)) {
    feedbackAttachmentError(400, `Unsupported attachment type: ${type || 'unknown'}`)
  }
  const ext = extensionOf(fileName)
  const allowedExtensions = new Set([
    ...Object.values(IMAGE_EXTENSIONS).flat(),
    '.pdf',
    ...Object.keys(TEXT_EXTENSIONS),
  ])
  if (!allowedExtensions.has(ext)) {
    feedbackAttachmentError(400, 'Unsupported file extension. Allowed: png, jpg, webp, gif, pdf, txt, log, json')
  }
  if (type === 'application/octet-stream' && !(ext in TEXT_EXTENSIONS)) {
    feedbackAttachmentError(400, `Unsupported attachment type: ${type}`)
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    feedbackAttachmentError(400, 'Attachment is empty')
  }
  if (sizeBytes > FEEDBACK_ATTACHMENT_MAX_BYTES) {
    feedbackAttachmentError(
      400,
      `Attachment is too large. Maximum size is ${FEEDBACK_ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB`
    )
  }
  return type
}

function startsWith(buffer: Buffer, bytes: number[], offset = 0) {
  if (buffer.length < offset + bytes.length) return false
  return bytes.every((byte, index) => buffer[offset + index] === byte)
}

function detectBinary(buffer: Buffer): { contentType: string; kind: FeedbackAttachmentKind; extension: string } | null {
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { contentType: 'image/png', kind: 'image', extension: '.png' }
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { contentType: 'image/jpeg', kind: 'image', extension: '.jpg' }
  if (buffer.subarray(0, 6).toString('latin1') === 'GIF87a' || buffer.subarray(0, 6).toString('latin1') === 'GIF89a')
    return { contentType: 'image/gif', kind: 'image', extension: '.gif' }
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP')
    return { contentType: 'image/webp', kind: 'image', extension: '.webp' }
  // `%PDF-` must appear within the first 1024 bytes per the spec; we require it at 0.
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-')
    return { contentType: 'application/pdf', kind: 'file', extension: '.pdf' }
  return null
}

const FORBIDDEN_TEXT_PREFIXES = [
  /^\s*<!doctype/i,
  /^\s*<html/i,
  /^\s*<head/i,
  /^\s*<body/i,
  /^\s*<svg/i,
  /^\s*<\?xml/i,
  /^\s*<script/i,
  /^#!/,
]

function looksLikeExecutable(buffer: Buffer) {
  return (
    startsWith(buffer, [0x4d, 0x5a]) || // MZ (PE / DOS)
    startsWith(buffer, [0x7f, 0x45, 0x4c, 0x46]) || // ELF
    startsWith(buffer, [0xca, 0xfe, 0xba, 0xbe]) || // Mach-O fat / Java class
    startsWith(buffer, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) // zip / jar / docx
  )
}

/** UTF-8 text without NUL/control bytes (tab, CR, LF, ESC for ANSI colours tolerated). */
function decodePlainText(buffer: Buffer): string | null {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return null
  }
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i]
    if (byte === 0) return null
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x1b && byte !== 0x0c) return null
  }
  return text
}

/**
 * Determine what a buffer really is. The file extension and declared type are
 * only used to choose between text flavours and to detect mismatches; they never
 * widen the allowlist. SVG, HTML, archives and executables are rejected.
 */
export function sniffFeedbackAttachment(
  buffer: Buffer,
  fileName: string,
  declaredContentType?: string
): SniffedAttachment {
  if (buffer.length === 0) feedbackAttachmentError(400, 'Attachment is empty')
  if (buffer.length > FEEDBACK_ATTACHMENT_MAX_BYTES) {
    feedbackAttachmentError(
      400,
      `Attachment is too large. Maximum size is ${FEEDBACK_ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB`
    )
  }
  const ext = extensionOf(fileName)
  const declared = (declaredContentType || '').trim().toLowerCase().split(';')[0]

  const binary = detectBinary(buffer)
  if (binary) {
    // Declared binary types must agree with the bytes (a .png that is really a PDF is suspicious).
    const declaredIsBinary = declared in IMAGE_EXTENSIONS || declared === 'application/pdf'
    if (declaredIsBinary && declared !== binary.contentType) {
      feedbackAttachmentError(400, 'File content does not match its declared type')
    }
    const allowedExts = binary.kind === 'image' ? IMAGE_EXTENSIONS[binary.contentType] : ['.pdf']
    if (!allowedExts.includes(ext)) {
      feedbackAttachmentError(400, 'File extension does not match its content')
    }
    return binary
  }

  if (looksLikeExecutable(buffer)) feedbackAttachmentError(400, 'This file type is not allowed')

  const textType = TEXT_EXTENSIONS[ext]
  if (!textType) feedbackAttachmentError(400, 'Unsupported file type. Allowed: images, PDF, .txt, .log, .json')
  if (declared in IMAGE_EXTENSIONS || declared === 'application/pdf') {
    feedbackAttachmentError(400, 'File content does not match its declared type')
  }
  const text = decodePlainText(buffer)
  if (text === null) feedbackAttachmentError(400, 'Log files must be plain UTF-8 text')
  if (FORBIDDEN_TEXT_PREFIXES.some((pattern) => pattern.test(text.slice(0, 512)))) {
    feedbackAttachmentError(400, 'This file type is not allowed')
  }
  if (ext === '.json') {
    try {
      JSON.parse(text)
    } catch {
      feedbackAttachmentError(400, 'JSON attachment is not valid JSON')
    }
  }
  return { contentType: textType, kind: 'log', extension: ext }
}

export interface ProcessedAttachment extends SniffedAttachment {
  buffer: Buffer
  width: number | null
  height: number | null
  /** True when `buffer` differs from the uploaded bytes and must be re-written to storage. */
  rewritten: boolean
}

/**
 * Sniff and normalise. JPEG/PNG/WebP are decoded and re-encoded in the same
 * format, which drops EXIF/XMP/ICC metadata (GPS location, device info) and
 * proves the image actually decodes. GIFs carry no EXIF and are validated, not
 * re-encoded, to keep animation intact.
 */
export async function processFeedbackAttachment(
  buffer: Buffer,
  fileName: string,
  declaredContentType?: string
): Promise<ProcessedAttachment> {
  const sniffed = sniffFeedbackAttachment(buffer, fileName, declaredContentType)
  if (sniffed.kind !== 'image') {
    return { ...sniffed, buffer, width: null, height: null, rewritten: false }
  }

  try {
    const options = { failOn: 'error' as const, limitInputPixels: MAX_IMAGE_PIXELS }
    if (sniffed.contentType === 'image/gif') {
      const metadata = await sharp(buffer, { ...options, animated: true }).metadata()
      if (metadata.format !== 'gif') feedbackAttachmentError(400, 'Image could not be read')
      return {
        ...sniffed,
        buffer,
        width: metadata.width ?? null,
        height: metadata.pageHeight ?? metadata.height ?? null,
        rewritten: false,
      }
    }
    const pipeline = sharp(buffer, options).rotate()
    const format = sniffed.contentType === 'image/png' ? 'png' : sniffed.contentType === 'image/webp' ? 'webp' : 'jpeg'
    const { data, info } = await pipeline.toFormat(format).toBuffer({ resolveWithObject: true })
    return {
      ...sniffed,
      buffer: data,
      width: info.width,
      height: info.height,
      rewritten: true,
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error
    feedbackAttachmentError(400, 'Image could not be read or is too large')
  }
}

// --- Authorization decision ---------------------------------------------------

export interface AttachmentAccessInput {
  isTeamMember: boolean
  isAuthor: boolean
  projectIsPublic: boolean
  feedbackIsHidden: boolean
  feedbackIsSupportDerived: boolean
}

export interface AttachmentAccess {
  canView: boolean
  canUpload: boolean
  canDelete: boolean
}

/**
 * Single place that decides who may see/add/remove attachments of a feedback item.
 * - Team members: always.
 * - The author: their own item (view, add, remove).
 * - Anyone else (public board visitors): view only, on public products, never for
 *   hidden or support-derived items.
 */
export function decideAttachmentAccess(input: AttachmentAccessInput): AttachmentAccess {
  if (input.isTeamMember) return { canView: true, canUpload: true, canDelete: true }
  if (input.isAuthor && !input.feedbackIsSupportDerived) return { canView: true, canUpload: true, canDelete: true }
  const canView = input.projectIsPublic && !input.feedbackIsHidden && !input.feedbackIsSupportDerived
  return { canView, canUpload: false, canDelete: false }
}

// --- Signing ------------------------------------------------------------------

function getSecret(): string {
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

type SignPurpose = 'feedback-attachment-upload' | 'feedback-attachment-download'

function sign(purpose: SignPurpose, id: string, exp: number): string {
  return createHmac('sha256', getSecret()).update(`${purpose}:${id}:${exp}`).digest('base64url')
}

function verify(purpose: SignPurpose, id: string, exp: number, signature: string): boolean {
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return false
  const expected = Buffer.from(sign(purpose, id, exp))
  const provided = Buffer.from(signature)
  return expected.length === provided.length && timingSafeEqual(expected, provided)
}

export function signFeedbackAttachmentUploadToken(attachmentId: string, expiresAt: Date): string {
  const exp = Math.floor(expiresAt.getTime() / 1000)
  return `${attachmentId}.${exp}.${sign('feedback-attachment-upload', attachmentId, exp)}`
}

export function verifyFeedbackAttachmentUploadToken(token: string): { attachmentId: string; expiresAt: Date } {
  const [id, expRaw, signature, ...rest] = token.split('.')
  const exp = Number(expRaw)
  if (!id || !signature || rest.length > 0 || !verify('feedback-attachment-upload', id, exp, signature)) {
    feedbackAttachmentError(400, 'Upload token is invalid or has expired')
  }
  return { attachmentId: id, expiresAt: new Date(exp * 1000) }
}

/** Relative signed download URL, scoped to one attachment id and a short expiry. */
export function buildFeedbackAttachmentDownloadUrl(
  attachmentId: string,
  now: Date = new Date(),
  ttlSeconds = FEEDBACK_ATTACHMENT_DOWNLOAD_EXPIRES_SECONDS
): { url: string; expiresAt: Date } {
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000)
  const exp = Math.floor(expiresAt.getTime() / 1000)
  const signature = sign('feedback-attachment-download', attachmentId, exp)
  return {
    url: `/api/feedback-attachments/${encodeURIComponent(attachmentId)}/file?exp=${exp}&sig=${signature}`,
    expiresAt,
  }
}

export function verifyFeedbackAttachmentDownloadSignature(attachmentId: string, exp: unknown, sig: unknown): boolean {
  if (typeof sig !== 'string' || !/^[A-Za-z0-9_-]+$/.test(sig)) return false
  const expNumber = Number(exp)
  return verify('feedback-attachment-download', attachmentId, expNumber, sig)
}

export function isMissingStorageObject(error: unknown): boolean {
  const candidate = error as {
    code?: string
    name?: string
    statusCode?: number
    $metadata?: { httpStatusCode?: number }
  }
  return (
    candidate?.code === 'OBJECT_NOT_FOUND' ||
    candidate?.code === 'ENOENT' ||
    candidate?.name === 'NotFound' ||
    candidate?.name === 'NoSuchKey' ||
    candidate?.statusCode === 404 ||
    candidate?.$metadata?.httpStatusCode === 404
  )
}
