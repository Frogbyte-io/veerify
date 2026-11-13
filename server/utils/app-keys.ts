import { createHash, randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { projectApiKey } from '~/server/database/schema/feedback'
import { ErrorCode, createErrorResponse } from '~/server/utils/response'

export type ProjectApiKeyRow = typeof projectApiKey.$inferSelect
export type AppKeyRow = ProjectApiKeyRow & { kind: 'app'; productId: string }
export type ServerKeyRow = ProjectApiKeyRow & { kind: 'server' }
export type ProjectKeyKind = 'app' | 'server'

/** App keys are embedded in shipped apps and are effectively public. */
export const APP_KEY_PREFIX = 'vfy_pub_'
/** Server keys are secrets for a website's backend (form submissions); never ship them to a browser. */
export const SERVER_KEY_PREFIX = 'vfy_srv_'

const KEY_PREFIXES: Record<ProjectKeyKind, string> = { app: APP_KEY_PREFIX, server: SERVER_KEY_PREFIX }

const TITLE_MAX_LENGTH = 80

export function hashAppKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function generateAppKey(kind: ProjectKeyKind = 'app'): { key: string; keyPrefix: string; keyHash: string } {
  const key = KEY_PREFIXES[kind] + randomBytes(32).toString('base64url')
  return { key, keyPrefix: key.slice(0, 12), keyHash: hashAppKey(key) }
}

function readBearerToken(event: H3Event, prefix: string): string | null {
  const header = event.node.req.headers.authorization
  if (typeof header !== 'string') return null
  const match = /^bearer\s+(.+)$/i.exec(header.trim())
  const token = match?.[1]?.trim()
  return token && token.startsWith(prefix) ? token : null
}

export function readBearerAppKey(event: H3Event): string | null {
  return readBearerToken(event, APP_KEY_PREFIX)
}

function invalidKey(label: string) {
  return createError({
    statusCode: 401,
    statusMessage: 'Unauthorized',
    data: createErrorResponse(ErrorCode.UNAUTHORIZED, `Invalid ${label}`),
  })
}

async function findActiveKey(token: string, kind: ProjectKeyKind): Promise<ProjectApiKeyRow | undefined> {
  const [row] = await db
    .select()
    .from(projectApiKey)
    .where(
      and(eq(projectApiKey.keyHash, hashAppKey(token)), eq(projectApiKey.kind, kind), isNull(projectApiKey.revokedAt))
    )
    .limit(1)
  return row
}

export async function requireAppKey(event: H3Event): Promise<AppKeyRow> {
  const key = readBearerAppKey(event)
  if (!key) throw invalidKey('app key')

  const row = await findActiveKey(key, 'app')
  if (!row || !row.productId) throw invalidKey('app key')
  return row as AppKeyRow
}

/** A project server key (`Authorization: Bearer vfy_srv_...`), or 401. */
export async function requireServerKey(event: H3Event): Promise<ServerKeyRow> {
  const key = readBearerToken(event, SERVER_KEY_PREFIX)
  if (!key) throw invalidKey('server key')

  const row = await findActiveKey(key, 'server')
  if (!row) throw invalidKey('server key')
  return row as ServerKeyRow
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
