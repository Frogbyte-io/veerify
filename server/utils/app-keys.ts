import { createHash, randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { projectApiKey } from '~/server/database/schema/feedback'
import { ErrorCode, createErrorResponse } from '~/server/utils/response'

export type ProjectApiKeyRow = typeof projectApiKey.$inferSelect

export const APP_KEY_PREFIX = 'vfy_pub_'

const TITLE_MAX_LENGTH = 80

export function hashAppKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function generateAppKey(): { key: string; keyPrefix: string; keyHash: string } {
  const key = APP_KEY_PREFIX + randomBytes(32).toString('base64url')
  return { key, keyPrefix: key.slice(0, 12), keyHash: hashAppKey(key) }
}

export function readBearerAppKey(event: H3Event): string | null {
  const header = event.node.req.headers.authorization
  if (typeof header !== 'string') return null
  const match = /^bearer\s+(.+)$/i.exec(header.trim())
  const token = match?.[1]?.trim()
  return token && token.startsWith(APP_KEY_PREFIX) ? token : null
}

function invalidAppKey() {
  return createError({
    statusCode: 401,
    statusMessage: 'Unauthorized',
    data: createErrorResponse(ErrorCode.UNAUTHORIZED, 'Invalid app key'),
  })
}

export async function requireAppKey(event: H3Event): Promise<ProjectApiKeyRow> {
  const key = readBearerAppKey(event)
  if (!key) throw invalidAppKey()

  const [row] = await db
    .select()
    .from(projectApiKey)
    .where(and(eq(projectApiKey.keyHash, hashAppKey(key)), isNull(projectApiKey.revokedAt)))
    .limit(1)
  if (!row) throw invalidAppKey()
  return row
}

export function deriveTitle(description: string): string {
  const firstLine =
    description
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  const chars = Array.from(firstLine)
  return chars.length > TITLE_MAX_LENGTH ? chars.slice(0, TITLE_MAX_LENGTH - 1).join('') + '…' : firstLine
}

export function toFeedbackType(type: 'bug' | 'feature'): 'bug_report' | 'feature_request' {
  return type === 'bug' ? 'bug_report' : 'feature_request'
}
