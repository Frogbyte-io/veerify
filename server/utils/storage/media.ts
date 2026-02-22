import sharp from 'sharp'
import { createErrorResponse, ErrorCode } from '../response'

export type UploadAssetKind = 'logo' | 'banner'

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const ALLOWED_SHARP_FORMATS = new Set(['jpeg', 'png', 'webp'])

const MAX_BYTES_BY_KIND: Record<UploadAssetKind, number> = {
  logo: 2 * 1024 * 1024,
  banner: 8 * 1024 * 1024,
}

export const TEMP_UPLOAD_EXPIRES_SECONDS = 15 * 60
export const TEMP_UPLOAD_PREFIX = 'tmp'
export const FINAL_UPLOAD_PREFIX = 'projects'

export function validateImageUploadInput(kind: UploadAssetKind, contentType: string, sizeBytes: number) {
  if (!ALLOWED_MIME_TYPES.has(contentType)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Validation failed',
      data: createErrorResponse(
        ErrorCode.VALIDATION_ERROR,
        `Unsupported image type. Allowed types: ${Array.from(ALLOWED_MIME_TYPES).join(', ')}`
      ),
    })
  }

  const maxBytes = MAX_BYTES_BY_KIND[kind]
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxBytes) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Validation failed',
      data: createErrorResponse(
        ErrorCode.VALIDATION_ERROR,
        `${kind} file is too large. Maximum size is ${Math.floor(maxBytes / (1024 * 1024))} MB`
      ),
    })
  }
}

function sanitizeFilename(filename: string) {
  const cleaned = filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned || 'upload'
}

export function buildTempObjectKey(projectId: string, kind: UploadAssetKind, filename: string) {
  const safeName = sanitizeFilename(filename)
  return `${TEMP_UPLOAD_PREFIX}/projects/${projectId}/${kind}/${Date.now()}-${crypto.randomUUID()}-${safeName}`
}

export function buildFinalObjectKey(projectId: string, kind: UploadAssetKind) {
  return `${FINAL_UPLOAD_PREFIX}/${projectId}/${kind}/${Date.now()}-${crypto.randomUUID()}.webp`
}

function createValidationError(message: string): never {
  throw createError({
    statusCode: 400,
    statusMessage: 'Validation failed',
    data: createErrorResponse(ErrorCode.VALIDATION_ERROR, message),
  })
}

export async function transformImageForKind(buffer: Buffer, kind: UploadAssetKind) {
  const image = sharp(buffer, { failOn: 'error' }).rotate()
  const metadata = await image.metadata()
  if (!metadata.format || !ALLOWED_SHARP_FORMATS.has(metadata.format)) {
    createValidationError('Unsupported image format. Please upload JPEG, PNG, or WebP')
  }

  if (kind === 'logo') {
    image.resize({
      width: 512,
      height: 512,
      fit: 'inside',
      withoutEnlargement: true,
    })
  } else {
    image.resize({
      width: 1600,
      height: 400,
      fit: 'cover',
      position: 'centre',
    })
  }

  const transformedBuffer = await image
    .webp({
      quality: 86,
      alphaQuality: 90,
      effort: 4,
    })
    .toBuffer()

  return {
    buffer: transformedBuffer,
    contentType: 'image/webp',
  }
}
