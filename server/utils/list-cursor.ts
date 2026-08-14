import { createError } from 'h3'
import { z } from 'zod'
import { createErrorResponse, ErrorCode } from './response'

/**
 * Opaque `(createdAt, id)` cursor for keyset-paginated lists ordered by
 * `desc(createdAt), desc(id)`. The id tie-breaker is what keeps pagination
 * stable when two rows share a `createdAt` down to the millisecond.
 *
 * Factored out of `contact-cursor.ts` when `supportCompany` needed the same
 * shape (SUP-01-6) rather than duplicating the encode/decode pair — the id
 * tie-breaker logic is exactly the risky part worth having once.
 */

export type ListCursor = {
  createdAt: Date
  id: string
}

const cursorPayloadSchema = z
  .object({
    createdAt: z.string().datetime({ offset: true }),
    id: z.string().trim().min(1).max(200),
  })
  .strict()

export function encodeListCursor(cursor: ListCursor): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    })
  ).toString('base64url')
}

/** `label` names the entity in the 400 response, e.g. "contact" or "company". */
export function decodeListCursor(value: string, label: string): ListCursor {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8')
    const parsed = cursorPayloadSchema.parse(JSON.parse(decoded))
    return { createdAt: new Date(parsed.createdAt), id: parsed.id }
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: createErrorResponse(ErrorCode.VALIDATION_ERROR, `Invalid ${label} cursor`),
    })
  }
}
