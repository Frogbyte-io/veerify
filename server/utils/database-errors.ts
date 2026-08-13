import { createError } from 'h3'
import { createErrorResponse, ErrorCode } from './response'

const DATABASE_CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  '08000',
  '08001',
  '08003',
  '08006',
  '57P01',
  '57P02',
  '57P03',
])

function collectErrorCodes(error: unknown, codes = new Set<string>()) {
  if (!error || typeof error !== 'object') return codes

  const typedError = error as { code?: unknown; cause?: unknown; errors?: unknown }
  if (typeof typedError.code === 'string' && typedError.code.trim()) {
    codes.add(typedError.code)
  }

  if (Array.isArray(typedError.errors)) {
    for (const nestedError of typedError.errors) {
      collectErrorCodes(nestedError, codes)
    }
  }

  if (typedError.cause) {
    collectErrorCodes(typedError.cause, codes)
  }

  return codes
}

export function isDatabaseConnectionError(error: unknown) {
  const codes = collectErrorCodes(error)
  for (const code of codes) {
    if (DATABASE_CONNECTION_ERROR_CODES.has(code)) {
      return true
    }
  }
  return false
}

export function summarizeDatabaseConnectionError(error: unknown) {
  const codes = [...collectErrorCodes(error)]
  const typedError = error as { message?: unknown }

  return {
    codes,
    message: typeof typedError?.message === 'string' ? typedError.message : 'Database connection failed',
  }
}

export function createDatabaseUnavailableError() {
  throw createError({
    statusCode: 503,
    statusMessage: 'Service Unavailable',
    data: createErrorResponse(
      ErrorCode.SERVICE_UNAVAILABLE,
      'Database is unavailable. Start PostgreSQL and retry. For local dev use: docker compose -f docker-compose-dev.yml up -d'
    ),
  })
}
