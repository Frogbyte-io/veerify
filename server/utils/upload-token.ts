import { createHmac, timingSafeEqual } from 'node:crypto'
import { createErrorResponse, ErrorCode } from './response'
import type { UploadAssetKind } from './storage/media'

export interface UploadTokenPayload {
  projectId: string
  userId: string
  kind: UploadAssetKind
  tempKey: string
  contentType: string
  exp: number
}

function toBase64Url(value: string | Buffer) {
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
      data: createErrorResponse(ErrorCode.INTERNAL_ERROR, 'Missing UPLOAD_TOKEN_SECRET or BETTER_AUTH_SECRET'),
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

export function createUploadToken(
  payload: Omit<UploadTokenPayload, 'exp'>,
  expiresInSeconds: number
): { token: string; expiresAt: string; payload: UploadTokenPayload } {
  const secret = getUploadTokenSecret()
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds
  const completePayload: UploadTokenPayload = {
    ...payload,
    exp,
  }
  const payloadBase64 = toBase64Url(JSON.stringify(completePayload))
  const signature = signPayload(payloadBase64, secret)
  return {
    token: `${payloadBase64}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
    payload: completePayload,
  }
}

export function verifyUploadToken(token: string): UploadTokenPayload {
  const secret = getUploadTokenSecret()
  const [payloadBase64, signature] = token.split('.')
  if (!payloadBase64 || !signature) {
    invalidTokenError('Malformed upload token')
  }

  const expectedSignature = signPayload(payloadBase64, secret)
  const providedBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    invalidTokenError('Upload token signature is invalid')
  }

  let payload: UploadTokenPayload | null = null
  try {
    payload = JSON.parse(fromBase64Url(payloadBase64)) as UploadTokenPayload
  } catch {
    invalidTokenError('Failed to parse upload token')
  }

  if (!payload || !payload.projectId || !payload.userId || !payload.kind || !payload.tempKey || !payload.contentType) {
    invalidTokenError('Upload token payload is incomplete')
  }

  const nowUnix = Math.floor(Date.now() / 1000)
  if (!Number.isFinite(payload.exp) || payload.exp <= nowUnix) {
    invalidTokenError('Upload token has expired')
  }

  return payload
}
