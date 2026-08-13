import { createError } from 'h3'
import { z } from 'zod'
import { createErrorResponse, ErrorCode } from './response'

const cursorPayloadSchema = z
  .object({
    createdAt: z.string().datetime({ offset: true }),
    id: z.string().trim().min(1).max(200),
  })
  .strict()

export type ContactCursor = {
  createdAt: Date
  id: string
}

export function encodeContactCursor(cursor: ContactCursor): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    })
  ).toString('base64url')
}

export function decodeContactCursor(value: string): ContactCursor {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8')
    const parsed = cursorPayloadSchema.parse(JSON.parse(decoded))
    return { createdAt: new Date(parsed.createdAt), id: parsed.id }
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, 'Invalid contact cursor'),
    })
  }
}
