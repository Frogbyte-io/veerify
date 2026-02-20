/**
 * Anonymous session management for unauthenticated feedback actions.
 *
 * On first feedback action (create or vote), a UUID token is generated,
 * stored in an HttpOnly cookie (`veerify_anon_session`), and persisted
 * in the `anonymous_session` table.  The session survives browser restarts
 * and expires after 90 days of inactivity.
 */

import type { H3Event } from 'h3'
import { eq, and, gt } from 'drizzle-orm'
import { db } from '~/server/database/drizzle'
import { anonymousSession } from '~/server/database/schema/feedback'

const COOKIE_NAME = 'veerify_anon_session'
const SESSION_TTL_DAYS = 90
const MS_PER_DAY = 24 * 60 * 60 * 1000

function getExpiresAt(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * MS_PER_DAY)
}

/**
 * Reads the anonymous session token from the request cookie.
 * Returns null if no cookie is set.
 */
export function readAnonToken(event: H3Event): string | null {
  return getCookie(event, COOKIE_NAME) || null
}

/**
 * Sets the anonymous session cookie on the response.
 */
function setAnonCookie(event: H3Event, token: string, expiresAt: Date) {
  setCookie(event, COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}

/**
 * Clears the anonymous session cookie.
 */
export function clearAnonCookie(event: H3Event) {
  deleteCookie(event, COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })
}

export interface AnonSession {
  id: string
  token: string
}

/**
 * Looks up a valid (non-expired) anonymous session by token.
 * If found, refreshes `lastSeenAt` and cookie expiry.
 * Returns null if the session does not exist or has expired.
 */
export async function getAnonSession(event: H3Event): Promise<AnonSession | null> {
  const token = readAnonToken(event)
  if (!token) return null

  const [row] = await db
    .select({ id: anonymousSession.id, token: anonymousSession.token })
    .from(anonymousSession)
    .where(and(eq(anonymousSession.token, token), gt(anonymousSession.expiresAt, new Date())))
    .limit(1)

  if (!row) return null

  // Refresh the session activity window
  const newExpiry = getExpiresAt()
  await db
    .update(anonymousSession)
    .set({ lastSeenAt: new Date(), expiresAt: newExpiry })
    .where(eq(anonymousSession.id, row.id))

  setAnonCookie(event, row.token, newExpiry)

  return { id: row.id, token: row.token }
}

/**
 * Returns the existing anonymous session or creates a new one.
 * Always sets/refreshes the HttpOnly cookie.
 */
export async function getOrCreateAnonSession(event: H3Event): Promise<AnonSession> {
  const existing = await getAnonSession(event)
  if (existing) return existing

  const id = crypto.randomUUID()
  const token = crypto.randomUUID()
  const now = new Date()
  const expiresAt = getExpiresAt()

  const ipAddress =
    getHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() || event.node.req.socket?.remoteAddress || null
  const userAgent = getHeader(event, 'user-agent') || null

  await db.insert(anonymousSession).values({
    id,
    token,
    ipAddress,
    userAgent,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  })

  setAnonCookie(event, token, expiresAt)

  return { id, token }
}
